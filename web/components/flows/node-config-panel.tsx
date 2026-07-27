"use client";

import { useRef, useState } from "react";
import { nodeDef, MAX_REFERENCE_ASSETS, type NodeType } from "@/lib/flows/node-registry";

export type FlowAssetView = {
  id: string;
  url: string;
  mime: string;
  size_bytes: number;
};

type Props = {
  nodeId: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
  assets: FlowAssetView[];
  onConfigChange: (patch: Record<string, unknown>) => void;
  onDeleteNode: () => void;
  onUploadAsset: (file: File) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/40";
const selectClass =
  "mt-1 w-full rounded-md border border-white/15 bg-[#0a0f1e] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/40";
const labelClass = "block text-xs text-white/60";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function NodeConfigPanel({
  nodeId,
  nodeType,
  config,
  assets,
  onConfigChange,
  onDeleteNode,
  onUploadAsset,
  onDeleteAsset,
}: Props) {
  const def = nodeDef(nodeType);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  if (!def) return null;

  const parsed = def.configSchema.safeParse(config);
  const firstIssue = parsed.success ? null : parsed.error.issues[0];

  async function handleUpload(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUploadAsset(file);
    } catch {
      setUploadError("Falha no upload — png/jpeg/webp até 5MB.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const selectedRefs = Array.isArray(config.referenceAssetIds) ? (config.referenceAssetIds as string[]) : [];

  function toggleRef(assetId: string) {
    const next = selectedRefs.includes(assetId)
      ? selectedRefs.filter((r) => r !== assetId)
      : [...selectedRefs, assetId].slice(0, MAX_REFERENCE_ASSETS);
    onConfigChange({ referenceAssetIds: next });
  }

  return (
    <aside className="tech-panel flex h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-white/8 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-white/90">{def.label}</h2>
          <p className="font-mono text-[10px] text-white/30">{nodeId}</p>
        </div>
        <button
          type="button"
          onClick={onDeleteNode}
          className="rounded border border-rose-300/25 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-rose-200/80 transition hover:bg-rose-400/10"
        >
          Remover
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-white/40">{def.description}</p>

      {nodeType === "scrape" ? (
        <label className={labelClass}>
          URL da página (https)
          <input
            value={str(config.url)}
            onChange={(e) => onConfigChange({ url: e.target.value })}
            placeholder="https://cliente.com/pagina-de-vendas"
            className={inputClass}
          />
        </label>
      ) : null}

      {nodeType === "copy" ? (
        <>
          <label className={labelClass}>
            Objetivo
            <select
              value={str(config.objective) || "traffic"}
              onChange={(e) => onConfigChange({ objective: e.target.value })}
              className={selectClass}
            >
              <option value="traffic">Tráfego</option>
              <option value="sales">Vendas</option>
              <option value="leads">Leads</option>
            </select>
          </label>
          <label className={labelClass}>
            Idioma
            <select
              value={str(config.language) || "pt-BR"}
              onChange={(e) => onConfigChange({ language: e.target.value })}
              className={selectClass}
            >
              <option value="pt-BR">Português (BR)</option>
              <option value="en-US">Inglês (US)</option>
            </select>
          </label>
          <label className={labelClass}>
            Dicas de tom (opcional)
            <textarea
              value={str(config.toneHints)}
              onChange={(e) => onConfigChange({ toneHints: e.target.value || undefined })}
              maxLength={200}
              rows={3}
              className={inputClass}
            />
          </label>
          <p className="text-[10px] text-white/30">Sempre 3 variações, cada uma com um gatilho mental distinto.</p>
        </>
      ) : null}

      {nodeType === "image_creative" ? (
        <>
          <label className={labelClass}>
            Formato
            <select
              value={str(config.aspect) || "1:1"}
              onChange={(e) => onConfigChange({ aspect: e.target.value })}
              className={selectClass}
            >
              <option value="1:1">1:1 (feed)</option>
              <option value="9:16">9:16 (stories/reels)</option>
              <option value="1.91:1">1.91:1 (link ad)</option>
            </select>
          </label>
          <label className={labelClass}>
            Variações por copy
            <select
              value={String(typeof config.variants === "number" ? config.variants : 1)}
              onChange={(e) => onConfigChange({ variants: Number(e.target.value) })}
              className={selectClass}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <label className={labelClass}>
            Notas de marca (opcional)
            <textarea
              value={str(config.brandNotes)}
              onChange={(e) => onConfigChange({ brandNotes: e.target.value || undefined })}
              maxLength={300}
              rows={3}
              placeholder="Ex.: paleta navy/laranja, sem texto na imagem"
              className={inputClass}
            />
          </label>

          <div>
            <div className="flex items-center justify-between">
              <span className={labelClass}>
                Referências/logos ({selectedRefs.length}/{MAX_REFERENCE_ASSETS})
              </span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="rounded border border-cyan-300/25 px-2 py-1 text-[10px] text-cyan-200/80 transition hover:bg-cyan-400/10 disabled:opacity-40"
              >
                {uploading ? "Enviando…" : "Enviar"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => handleUpload(e.target.files?.[0])}
              />
            </div>
            {uploadError ? <p className="mt-1 text-[10px] text-rose-300">{uploadError}</p> : null}
            <p className="mt-1 text-[10px] text-white/30">
              Selecionadas entram no prompt e SEMPRE aparecem nas imagens geradas.
            </p>
            {assets.length === 0 ? (
              <p className="mt-2 text-[11px] text-white/35">Nenhuma referência enviada ainda.</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {assets.map((asset) => {
                  const active = selectedRefs.includes(asset.id);
                  return (
                    <div key={asset.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => toggleRef(asset.id)}
                        className={`block aspect-square w-full overflow-hidden rounded border transition ${
                          active ? "border-cyan-300/70 ring-1 ring-cyan-300/40" : "border-white/10 opacity-60 hover:opacity-100"
                        }`}
                        title={active ? "Clique para desmarcar" : "Clique para usar como referência"}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- pequenas thumbs de bucket público */}
                        <img src={asset.url} alt="referência" className="h-full w-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteAsset(asset.id)}
                        className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border border-rose-300/40 bg-[#0a0f1e] text-[9px] text-rose-200 group-hover:flex"
                        title="Excluir arquivo"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}

      {nodeType === "approval" ? (
        <label className="flex items-center gap-2 text-xs text-white/60">
          <input
            type="checkbox"
            checked={config.notifyTelegram !== false}
            onChange={(e) => onConfigChange({ notifyTelegram: e.target.checked })}
            className="h-4 w-4 accent-cyan-400"
          />
          Notificar no Telegram quando aguardar aprovação
        </label>
      ) : null}

      {nodeType === "meta_campaign" ? (
        <>
          <label className={labelClass}>
            Tipo de campanha
            <select
              value={str(config.campaignType)}
              onChange={(e) => onConfigChange({ campaignType: e.target.value })}
              className={selectClass}
            >
              <option value="">Selecione…</option>
              <option value="OUTCOME_TRAFFIC">Tráfego</option>
              <option value="OUTCOME_SALES">Vendas</option>
              <option value="OUTCOME_LEADS">Leads</option>
            </select>
          </label>
          <label className={labelClass}>
            Página do Facebook (pageId)
            <input
              value={str(config.pageId)}
              onChange={(e) => onConfigChange({ pageId: e.target.value })}
              placeholder="Ex.: 1234567890"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Pixel (obrigatório p/ vendas e leads)
            <input
              value={str(config.pixelId)}
              onChange={(e) => onConfigChange({ pixelId: e.target.value || undefined })}
              placeholder="Ex.: 9876543210"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Link de destino (https)
            <input
              value={str(config.linkUrl)}
              onChange={(e) => onConfigChange({ linkUrl: e.target.value })}
              placeholder="https://cliente.com/oferta"
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Orçamento diário (R$)
            <input
              type="number"
              min={1}
              step="0.01"
              value={typeof config.dailyBudgetCents === "number" ? config.dailyBudgetCents / 100 : ""}
              onChange={(e) => {
                const reais = Number(e.target.value);
                onConfigChange({
                  dailyBudgetCents: Number.isFinite(reais) && reais > 0 ? Math.round(reais * 100) : undefined,
                });
              }}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Nome da campanha (opcional)
            <input
              value={str(config.campaignName)}
              onChange={(e) => onConfigChange({ campaignName: e.target.value || undefined })}
              maxLength={80}
              className={inputClass}
            />
          </label>
          <p className="text-[10px] text-white/30">
            Tudo é criado PAUSED e respeita o teto de orçamento do cliente. Ativação é sempre fora do flow.
          </p>
        </>
      ) : null}

      {firstIssue ? (
        <p className="mt-auto rounded border border-amber-300/25 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-200/90">
          {firstIssue.path.join(".") || "config"}: {firstIssue.message}
        </p>
      ) : (
        <p className="mt-auto rounded border border-emerald-300/20 bg-emerald-400/[0.05] px-3 py-2 text-[11px] text-emerald-200/70">
          Config válido.
        </p>
      )}
    </aside>
  );
}
