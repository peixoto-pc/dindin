import type { ImportedTransaction, ImportStatement } from "@/shared/lib/import/types";

function parseDateValue(value: string): string | null {
	const str = value.trim();

	// DD/MM/YYYY
	const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (dmyMatch) {
		return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
	}

	// YYYY-MM-DD
	const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (isoMatch) return str;

	return null;
}

function parseAmountValue(value: string): number | null {
	const num = Number.parseFloat(
		value.trim().replace(",", ".").replace(/[^\d.-]/g, ""),
	);
	return Number.isNaN(num) || num <= 0 ? null : num;
}

function parseCsvRow(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let insideQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];

		if (char === '"') {
			if (insideQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
			} else {
				insideQuotes = !insideQuotes;
			}
		} else if (char === "," && !insideQuotes) {
			fields.push(current);
			current = "";
		} else {
			current += char;
		}
	}

	fields.push(current);
	return fields;
}

export function parseCsv(content: string): ImportStatement {
	const lines = content
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.split("\n")
		.filter((line) => line.trim() !== "");

	if (lines.length < 2) {
		throw new Error("Arquivo CSV vazio ou sem dados.");
	}

	const transactions: ImportedTransaction[] = [];

	for (let i = 1; i < lines.length; i++) {
		const fields = parseCsvRow(lines[i]);
		if (fields.length < 3) continue;

		const date = parseDateValue(fields[0] ?? "");
		const description = (fields[1] ?? "").trim();
		const amount = parseAmountValue(fields[2] ?? "");
		const typeRaw = (fields[3] ?? "").toLowerCase().trim();
		const transactionType = typeRaw === "receita" ? "income" : "expense";

		if (!date || !description || amount === null) continue;

		transactions.push({
			externalId: null,
			date,
			amount,
			description,
			transactionType,
		});
	}

	if (transactions.length === 0) {
		throw new Error("Nenhuma transação válida encontrada no CSV.");
	}

	const dates = transactions.map((t) => t.date).sort();
	const period = { from: dates[0], to: dates[dates.length - 1] };

	return {
		source: "CSV",
		accountNumber: null,
		period,
		isCreditCard: false,
		transactions,
	};
}

export function generateCsvTemplate(): string {
	const rows = [
		["Data", "Descrição", "Valor", "Tipo"],
		["01/03/2026", "Ingressos São Januário", "160.00", "despesa"],
		["01/03/2026", "Salário", "3000.00", "receita"],
		["01/03/2026", "Posto do Vasco da Gama", "89.90", "despesa"],
	];

	return rows.map((row) => row.join(",")).join("\n");
}
