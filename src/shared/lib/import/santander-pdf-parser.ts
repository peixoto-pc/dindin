import type { ImportedTransaction, ImportStatement } from "./types";

export type SantanderCard = {
	last4: string;
	holderName: string;
	isAdditional: boolean; // cartão com prefixo "@" (virtual/adicional)
};

const CARD_HEADER_RE =
	/^([@\s]*)([A-Z][A-Z\s]+?)\s*-\s*4258\s+XXXX\s+XXXX\s+(\d{4})\s*$/i;
const DATE_IN_LINE_RE = /(\d{2})\/(\d{2})\s+/;
const BRL_AMOUNT_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
const INSTALLMENT_SUFFIX_RE = /\s+(\d{2}\/\d{2,3})\s*$/;

const SKIP_LINE_RE =
	/^(Pagamento e Demais|Parcelamentos|Despesas|VALOR TOTAL|Compra\s+Data|COTAÇÃO)/;
const SKIP_DESC_PREFIXES = ["PAGAMENTO DE FATURA"];

async function extractLinesFromPdf(buffer: ArrayBuffer): Promise<string[]> {
	const pdfjsLib = await import("pdfjs-dist");
	pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

	const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) })
		.promise;
	const lines: string[] = [];

	for (let p = 1; p <= pdf.numPages; p++) {
		const page = await pdf.getPage(p);
		const vp = page.getViewport({ scale: 1.0 });
		const midX = vp.width / 2;
		const content = await page.getTextContent();

		const cols: [
			Map<number, Array<{ str: string; x: number }>>,
			Map<number, Array<{ str: string; x: number }>>,
		] = [new Map(), new Map()];

		for (const item of content.items) {
			if (!("str" in item) || !item.str.trim()) continue;
			const x = item.transform[4];
			const y = Math.round(vp.height - item.transform[5]);
			const col = x < midX ? 0 : 1;
			const map = cols[col];

			let key = y;
			for (const k of map.keys()) {
				if (Math.abs(k - y) <= 3) {
					key = k;
					break;
				}
			}
			if (!map.has(key)) map.set(key, []);
			map.get(key)?.push({ str: item.str, x });
		}

		// Por página: coluna esquerda topo→base, depois coluna direita
		for (const col of cols) {
			for (const [, items] of [...col.entries()].sort(([a], [b]) => a - b)) {
				const text = items
					.sort((a, b) => a.x - b.x)
					.map((i) => i.str)
					.join(" ")
					.trim();
				if (text) lines.push(text);
			}
		}
	}

	return lines;
}

function parseBRL(s: string): number {
	return Number.parseFloat(s.replace(/\./g, "").replace(",", "."));
}

// Infere o ano com base na data de vencimento da fatura:
// meses após o vencimento pertencem ao ano anterior (ex: nov/2025 em fatura jun/2026).
function inferYear(day: string, month: string, billingEndDate: string): string {
	const byear = Number.parseInt(billingEndDate.slice(0, 4), 10);
	const bmonth = Number.parseInt(billingEndDate.slice(5, 7), 10);
	const year = Number.parseInt(month, 10) > bmonth ? byear - 1 : byear;
	return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Lê o PDF e retorna os cartões encontrados na fatura para seleção do usuário.
export async function detectSantanderCards(
	buffer: ArrayBuffer,
): Promise<SantanderCard[]> {
	const lines = await extractLinesFromPdf(buffer);
	const cards: SantanderCard[] = [];
	const seen = new Set<string>();

	for (const line of lines) {
		const match = line.match(CARD_HEADER_RE);
		if (!match) continue;
		const last4 = match[3];
		if (seen.has(last4)) continue;
		seen.add(last4);
		cards.push({
			last4,
			holderName: match[2].trim(),
			isAdditional: match[1].includes("@"),
		});
	}

	return cards;
}

// Faz o parse completo da fatura para os cartões selecionados.
export async function parseSantanderPdf(
	buffer: ArrayBuffer,
	targetLast4: Set<string>,
): Promise<ImportStatement> {
	const lines = await extractLinesFromPdf(buffer);

	let billingEndDate = new Date().toISOString().slice(0, 10);
	const fullText = lines.join(" ");
	const vencMatch = fullText.match(/Vencimento\s+(\d{2})\/(\d{2})\/(\d{4})/i);
	if (vencMatch) {
		billingEndDate = `${vencMatch[3]}-${vencMatch[2]}-${vencMatch[1]}`;
	}

	const transactions: ImportedTransaction[] = [];
	let inTargetCard = false;
	let lastDate = billingEndDate;

	for (const line of lines) {
		const cardMatch = line.match(CARD_HEADER_RE);
		if (cardMatch) {
			inTargetCard = targetLast4.has(cardMatch[3]);
			continue;
		}

		if (!inTargetCard) continue;
		if (SKIP_LINE_RE.test(line)) continue;

		// Linhas de IOF sem data: continuação da transação anterior
		if (/^IOF\b/i.test(line)) {
			const iofAmounts = [...line.matchAll(BRL_AMOUNT_RE)];
			if (iofAmounts.length > 0 && transactions.length > 0) {
				const iofAmount = parseBRL(iofAmounts[0][0]);
				if (iofAmount > 0 && iofAmount < 500) {
					const lastTx = transactions[transactions.length - 1];
					transactions.push({
						externalId: null,
						date: lastDate,
						amount: iofAmount,
						description: `IOF - ${lastTx.description}`,
						transactionType: "expense",
					});
				}
			}
			continue;
		}

		const dateMatch = line.match(DATE_IN_LINE_RE);
		if (!dateMatch || dateMatch.index === undefined) continue;

		const content = line.slice(dateMatch.index + dateMatch[0].length).trim();
		if (!content) continue;

		const amountMatches = [...content.matchAll(BRL_AMOUNT_RE)];
		if (amountMatches.length === 0) continue;

		const firstMatch = amountMatches[0];
		const amount = parseBRL(firstMatch[0]);
		const descRaw = content.slice(0, firstMatch.index).trim();

		if (!descRaw) continue;
		if (amount === 0) continue;
		if (amount < -500) continue;
		if (SKIP_DESC_PREFIXES.some((p) => descRaw.startsWith(p))) continue;

		const instMatch = descRaw.match(INSTALLMENT_SUFFIX_RE);
		let description = descRaw;
		if (instMatch) {
			description = `${descRaw.slice(0, instMatch.index).trim()} (${instMatch[1]})`;
		}

		lastDate = inferYear(dateMatch[1], dateMatch[2], billingEndDate);
		transactions.push({
			externalId: null,
			date: lastDate,
			amount: Math.abs(amount),
			description,
			transactionType: amount < 0 ? "income" : "expense",
		});
	}

	return {
		source: "Santander",
		accountNumber: null,
		period: null,
		isCreditCard: true,
		transactions,
	};
}
