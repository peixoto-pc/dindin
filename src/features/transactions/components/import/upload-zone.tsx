"use client";

import {
	RiDownloadLine,
	RiLoader4Line,
	RiUploadCloud2Line,
} from "@remixicon/react";
import { useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { generateCsvTemplate, parseCsv } from "@/shared/lib/import/csv-parser";
import { parseOfx } from "@/shared/lib/import/ofx-parser";
import {
	detectSantanderCards,
	parseSantanderPdf,
	type SantanderCard,
} from "@/shared/lib/import/santander-pdf-parser";
import type { ImportStatement } from "@/shared/lib/import/types";
import { generateXlsTemplate, parseXls } from "@/shared/lib/import/xls-parser";

interface UploadZoneProps {
	onParsed: (statement: ImportStatement) => void;
}

type PendingPdf = {
	buffer: ArrayBuffer;
	cards: SantanderCard[];
};

export function UploadZone({ onParsed }: UploadZoneProps) {
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const [pendingPdf, setPendingPdf] = useState<PendingPdf | null>(null);
	const [selectedLast4, setSelectedLast4] = useState<Set<string>>(new Set());
	const [isDetecting, setIsDetecting] = useState(false);
	const [isParsing, setIsParsing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFile = (file: File) => {
		setError(null);
		const isOfx = /\.(ofx|qfx)$/i.test(file.name);
		const isXls = /\.(xlsx|xls)$/i.test(file.name);
		const isCsv = /\.csv$/i.test(file.name);
		const isPdf = /\.pdf$/i.test(file.name);

		if (!isOfx && !isXls && !isCsv && !isPdf) {
			setError(
				"Formato não suportado. Use .ofx, .qfx, .xlsx, .xls, .csv ou .pdf (fatura Santander).",
			);
			return;
		}

		if (isOfx) {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const content = e.target?.result as string;
					const statement = parseOfx(content);
					if (statement.transactions.length === 0) {
						setError("Nenhuma transação encontrada no arquivo.");
						return;
					}
					onParsed(statement);
				} catch {
					setError(
						"Não foi possível ler o arquivo. Verifique se é um OFX válido.",
					);
				}
			};
			reader.readAsText(file, "windows-1252");
		} else if (isXls) {
			const reader = new FileReader();
			reader.onload = async (e) => {
				try {
					const buffer = e.target?.result as ArrayBuffer;
					const statement = await parseXls(buffer);
					onParsed(statement);
				} catch (err) {
					setError(
						err instanceof Error
							? err.message
							: "Não foi possível ler a planilha.",
					);
				}
			};
			reader.readAsArrayBuffer(file);
		} else if (isPdf) {
			const reader = new FileReader();
			reader.onload = async (e) => {
				setIsDetecting(true);
				try {
					const buffer = e.target?.result as ArrayBuffer;
					const cards = await detectSantanderCards(buffer);
					if (cards.length === 0) {
						setError(
							"Nenhum cartão encontrado. Verifique se é uma fatura Santander válida.",
						);
						return;
					}
					// Pré-seleciona todos os cartões
					setSelectedLast4(new Set(cards.map((c) => c.last4)));
					setPendingPdf({ buffer, cards });
				} catch {
					setError(
						"Não foi possível ler a fatura. Verifique se é um PDF do Santander válido.",
					);
				} finally {
					setIsDetecting(false);
				}
			};
			reader.readAsArrayBuffer(file);
		} else {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const content = e.target?.result as string;
					const statement = parseCsv(content);
					onParsed(statement);
				} catch (err) {
					setError(
						err instanceof Error
							? err.message
							: "Não foi possível ler o arquivo CSV.",
					);
				}
			};
			reader.readAsText(file, "utf-8");
		}
	};

	const toggleCard = (last4: string) => {
		setSelectedLast4((prev) => {
			const next = new Set(prev);
			if (next.has(last4)) {
				next.delete(last4);
			} else {
				next.add(last4);
			}
			return next;
		});
	};

	const handleConfirmCards = async () => {
		if (!pendingPdf || selectedLast4.size === 0) return;
		setIsParsing(true);
		try {
			const statement = await parseSantanderPdf(
				pendingPdf.buffer,
				selectedLast4,
			);
			if (statement.transactions.length === 0) {
				setError("Nenhuma transação encontrada para os cartões selecionados.");
				setPendingPdf(null);
				return;
			}
			onParsed(statement);
		} catch {
			setError("Erro ao processar a fatura. Tente novamente.");
		} finally {
			setIsParsing(false);
		}
	};

	const handleDownloadTemplate = async () => {
		const bytes = await generateXlsTemplate();
		const blob = new Blob([bytes], {
			type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "modelo-lancamentos.xlsx";
		a.click();
		URL.revokeObjectURL(url);
	};

	const handleDownloadCsvTemplate = () => {
		const content = generateCsvTemplate();
		const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "modelo-lancamentos.csv";
		a.click();
		URL.revokeObjectURL(url);
	};

	// Tela de seleção de cartões (após upload de PDF)
	if (pendingPdf) {
		return (
			<div className="flex flex-col gap-4">
				<div className="rounded-xl border p-6">
					<p className="mb-1 font-medium text-sm">
						Cartões encontrados na fatura
					</p>
					<p className="mb-5 text-muted-foreground text-xs">
						Selecione quais cartões deseja importar.
					</p>

					<div className="flex flex-col gap-3">
						{pendingPdf.cards.map((card) => (
							<label
								key={card.last4}
								className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40 has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
							>
								<Checkbox
									checked={selectedLast4.has(card.last4)}
									onCheckedChange={() => toggleCard(card.last4)}
								/>
								<div className="flex flex-1 items-center justify-between gap-2">
									<div>
										<p className="font-medium text-sm leading-tight">
											{card.holderName}
										</p>
										<p className="text-muted-foreground text-xs">
											•••• •••• •••• {card.last4}
										</p>
									</div>
									{card.isAdditional && (
										<span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
											Adicional
										</span>
									)}
								</div>
							</label>
						))}
					</div>
				</div>

				{error && <p className="text-destructive text-sm">{error}</p>}

				<div className="flex items-center justify-between">
					<button
						type="button"
						className="text-muted-foreground text-sm underline-offset-2 hover:text-foreground hover:underline"
						onClick={() => {
							setPendingPdf(null);
							setError(null);
						}}
					>
						Trocar arquivo
					</button>

					<Button
						onClick={handleConfirmCards}
						disabled={selectedLast4.size === 0 || isParsing}
					>
						{isParsing ? (
							<>
								<RiLoader4Line className="size-4 animate-spin" />
								Processando…
							</>
						) : (
							`Importar ${selectedLast4.size} cartão${selectedLast4.size !== 1 ? "ões" : ""}`
						)}
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<button
				type="button"
				onClick={() => inputRef.current?.click()}
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragging(false);
					const file = e.dataTransfer.files[0];
					if (file) handleFile(file);
				}}
				className={`flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-24 transition-colors ${
					dragging
						? "border-primary bg-primary/5"
						: "border-border hover:border-primary/50 hover:bg-muted/50"
				}`}
			>
				{isDetecting ? (
					<RiLoader4Line className="text-muted-foreground size-14 animate-spin" />
				) : (
					<RiUploadCloud2Line className="text-muted-foreground size-14" />
				)}
				<div className="text-center">
					<p className="font-medium text-sm">
						{isDetecting
							? "Lendo fatura…"
							: "Arraste um arquivo aqui ou clique para selecionar"}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						.ofx · .qfx · .xlsx · .xls · .csv · .pdf (fatura Santander)
					</p>
				</div>
			</button>

			<input
				ref={inputRef}
				type="file"
				accept=".ofx,.qfx,.xlsx,.xls,.csv,.pdf"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) handleFile(file);
					e.target.value = "";
				}}
			/>

			<div className="flex items-center justify-between">
				{error ? <p className="text-destructive text-sm">{error}</p> : <span />}
				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={handleDownloadTemplate}
						className="flex items-center gap-1.5 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
					>
						<RiDownloadLine className="size-3.5" />
						Baixar modelo .xlsx
					</button>
					<button
						type="button"
						onClick={handleDownloadCsvTemplate}
						className="flex items-center gap-1.5 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
					>
						<RiDownloadLine className="size-3.5" />
						Baixar modelo .csv
					</button>
				</div>
			</div>
		</div>
	);
}
