"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";

interface Filter { id: number; name: string; }
interface Pipeline { id: number; name: string; }
interface Stage { id: number; name: string; pipeline_id: number; }
interface Field {
  id: number;
  key: string;
  name: string;
  field_type: string;
  options?: Array<{ id: number; label: string }>;
}
interface ChainStep { from_value: number | null; to_value: number | null; }

export default function NewCampaignPage() {
  const router = useRouter();

  // ----- Pipedrive metadata -----
  const [filters, setFilters] = useState<Filter[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [f, p, fl] = await Promise.all([
          fetch("/api/pipedrive/filters").then((r) => r.json()),
          fetch("/api/pipedrive/pipelines").then((r) => r.json()),
          fetch("/api/pipedrive/fields").then((r) => r.json()),
        ]);
        if (f.error) throw new Error(f.error);
        if (p.error) throw new Error(p.error);
        if (fl.error) throw new Error(fl.error);
        setFilters(f.filters || []);
        setPipelines(p.pipelines || []);
        setStages(p.stages || []);
        setFields(fl.fields || []);
      } catch (e: unknown) {
        setMetaError(e instanceof Error ? e.message : String(e));
      } finally {
        setMetaLoading(false);
      }
    }
    load();
  }, []);

  // ----- Form state -----
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [sourceType, setSourceType] = useState<"pipedrive_filter" | "pipedrive_pipeline">("pipedrive_filter");
  const [filterId, setFilterId] = useState<number | "">("");
  const [pipelineId, setPipelineId] = useState<number | "">("");
  const [stageId, setStageId] = useState<number | "">("");

  const [fieldKey, setFieldKey] = useState<string>("");
  const [valueMode, setValueMode] = useState<"fixed" | "chain">("chain");
  const [fixedValue, setFixedValue] = useState<string>("");
  const [chain, setChain] = useState<ChainStep[]>([]);

  const [ratePerMinute, setRatePerMinute] = useState<number>(1);
  const [bizStart, setBizStart] = useState("08:00");
  const [bizEnd, setBizEnd] = useState("17:00");
  const [tz, setTz] = useState("America/Chicago");
  const [skipWeekends, setSkipWeekends] = useState(true);
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [customSkipDates, setCustomSkipDates] = useState<string>(""); // comma separated
  const [randomize, setRandomize] = useState(true);

  // ----- Derived -----
  const stagesForPipeline = useMemo(
    () => stages.filter((s) => s.pipeline_id === Number(pipelineId)),
    [stages, pipelineId]
  );
  const selectedField = useMemo(
    () => fields.find((f) => f.key === fieldKey) || null,
    [fields, fieldKey]
  );
  const fieldOptions = selectedField?.options || [];

  // ----- Preview audience -----
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewCapped, setPreviewCapped] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  async function doPreview() {
    setPreviewBusy(true);
    setPreviewErr(null);
    setPreviewCount(null);
    try {
      const source_config: Record<string, unknown> = {};
      if (sourceType === "pipedrive_filter") {
        if (!filterId) throw new Error("Pick a filter");
        source_config.filter_id = Number(filterId);
      } else {
        if (!pipelineId) throw new Error("Pick a pipeline");
        source_config.pipeline_id = Number(pipelineId);
        if (stageId) source_config.stage_id = Number(stageId);
      }
      const r = await fetch("/api/pipedrive/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: sourceType, source_config }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Preview failed");
      setPreviewCount(j.count);
      setPreviewCapped(j.capped);
    } catch (e: unknown) {
      setPreviewErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  // ----- Chain helpers -----
  function addChainStep() {
    setChain((c) => [...c, { from_value: null, to_value: null }]);
  }
  function updateChainStep(i: number, key: "from_value" | "to_value", v: number | null) {
    setChain((c) => c.map((s, j) => (j === i ? { ...s, [key]: v } : s)));
  }
  function removeChainStep(i: number) {
    setChain((c) => c.filter((_, j) => j !== i));
  }

  // ----- Submit -----
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  async function onCreateDraft(launchAfter: boolean) {
    setSaveErr(null);
    setSaving(true);
    try {
      if (!name.trim()) throw new Error("Name is required");
      if (!fieldKey) throw new Error("Pick a field to update");
      if (valueMode === "chain" && chain.length === 0) throw new Error("Add at least one chain step");

      const source_config: Record<string, unknown> = {};
      if (sourceType === "pipedrive_filter") {
        if (!filterId) throw new Error("Pick a filter");
        source_config.filter_id = Number(filterId);
      } else {
        if (!pipelineId) throw new Error("Pick a pipeline");
        source_config.pipeline_id = Number(pipelineId);
        if (stageId) source_config.stage_id = Number(stageId);
      }

      const action_config: Record<string, unknown> = {
        field_key: fieldKey,
        field_name: selectedField?.name || "",
        field_type: selectedField?.field_type || "",
        value_mode: valueMode,
      };
      if (valueMode === "fixed") {
        action_config.fixed_value =
          selectedField?.field_type === "enum"
            ? Number(fixedValue)
            : fixedValue;
      } else {
        action_config.chain = chain;
      }

      const skipDates = customSkipDates
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const r = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          source_type: sourceType,
          source_config,
          action_type: "update_deal_field",
          action_config,
          rate_per_minute: ratePerMinute,
          business_hours_start: bizStart,
          business_hours_end: bizEnd,
          timezone: tz,
          skip_weekends: skipWeekends,
          skip_holidays: skipHolidays,
          custom_skip_dates: skipDates,
          randomize_within_minute: randomize,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Create failed");

      const cid = j.campaign.id;
      if (launchAfter) {
        const lr = await fetch(`/api/campaigns/${cid}/launch`, { method: "POST" });
        const lj = await lr.json();
        if (!lr.ok) throw new Error(lj.error || "Launch failed");
      }
      router.push(`/campaigns/${cid}`);
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ----- Render -----
  return (
    <div className="min-h-screen">
      <AppHeader active="new" />
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">New campaign</h1>
          <p className="text-sm text-ink-500">
            Pick a Pipedrive audience, define what to do, set the pace. Phase 1 supports deal field updates only.
          </p>
        </div>

        {metaLoading && <div className="text-sm text-ink-400">Loading Pipedrive metadata…</div>}
        {metaError && (
          <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">
            Couldn&apos;t load Pipedrive metadata: {metaError}
          </div>
        )}

        {/* ---------- Basics ---------- */}
        <section className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Basics</h2>
          <div>
            <label className="label">Campaign name</label>
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)}
                   placeholder="e.g. Missed Opps — advance to next stage" />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea className="input mt-1" rows={2}
                      value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </section>

        {/* ---------- Source ---------- */}
        <section className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Audience</h2>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" checked={sourceType === "pipedrive_filter"}
                     onChange={() => setSourceType("pipedrive_filter")} />
              Pipedrive filter
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="source" checked={sourceType === "pipedrive_pipeline"}
                     onChange={() => setSourceType("pipedrive_pipeline")} />
              Pipeline / stage
            </label>
          </div>

          {sourceType === "pipedrive_filter" ? (
            <div>
              <label className="label">Filter</label>
              <select className="input mt-1" value={filterId} onChange={(e) => setFilterId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">— pick a filter —</option>
                {filters.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Pipeline</label>
                <select className="input mt-1" value={pipelineId} onChange={(e) => { setPipelineId(e.target.value ? Number(e.target.value) : ""); setStageId(""); }}>
                  <option value="">— pick a pipeline —</option>
                  {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Stage (optional)</label>
                <select className="input mt-1" value={stageId} onChange={(e) => setStageId(e.target.value ? Number(e.target.value) : "")} disabled={!pipelineId}>
                  <option value="">All stages</option>
                  {stagesForPipeline.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="button" className="btn-secondary text-sm" onClick={doPreview} disabled={previewBusy}>
              {previewBusy ? "Counting…" : "Preview audience"}
            </button>
            {previewCount !== null && (
              <div className="text-sm text-ink-700">
                Audience: <span className="font-mono font-semibold">{previewCount.toLocaleString()}</span>
                {previewCapped && <span className="text-amber-600"> (capped — actual may be higher)</span>}
              </div>
            )}
            {previewErr && <div className="text-sm text-red-600">{previewErr}</div>}
          </div>
        </section>

        {/* ---------- Action ---------- */}
        <section className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Action</h2>
          <div className="text-xs text-ink-500">Update a custom deal field. Email/SMS coming in Phase 2/3.</div>

          <div>
            <label className="label">Field to update</label>
            <select className="input mt-1" value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setChain([]); setFixedValue(""); }}>
              <option value="">— pick a field —</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name} {f.field_type === "enum" ? "(dropdown)" : `(${f.field_type})`}
                </option>
              ))}
            </select>
            {selectedField && (
              <div className="text-xs font-mono text-ink-400 mt-1">key: {selectedField.key}</div>
            )}
          </div>

          {selectedField && (
            <>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={valueMode === "chain"} onChange={() => setValueMode("chain")} />
                  Chain (advance through stages)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={valueMode === "fixed"} onChange={() => setValueMode("fixed")} />
                  Fixed value
                </label>
              </div>

              {valueMode === "fixed" && (
                <div>
                  <label className="label">Value to set on every matching deal</label>
                  {selectedField.field_type === "enum" ? (
                    <select className="input mt-1" value={fixedValue} onChange={(e) => setFixedValue(e.target.value)}>
                      <option value="">— pick —</option>
                      {fieldOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="input mt-1" value={fixedValue} onChange={(e) => setFixedValue(e.target.value)} />
                  )}
                </div>
              )}

              {valueMode === "chain" && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="label">Progression chain</label>
                    <button type="button" className="text-xs text-brand-500 hover:underline" onClick={addChainStep}>+ Add step</button>
                  </div>
                  {chain.length === 0 && (
                    <div className="text-xs text-ink-400 italic">
                      No steps yet. Each step says &ldquo;if the deal&apos;s current value is X, set it to Y.&rdquo;
                      Deals whose current value matches no &ldquo;from&rdquo; will be skipped.
                    </div>
                  )}
                  <div className="space-y-2">
                    {chain.map((step, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <ChainValuePicker
                          field={selectedField}
                          value={step.from_value}
                          onChange={(v) => updateChainStep(i, "from_value", v)}
                          allowBlank
                        />
                        <span className="text-ink-400">→</span>
                        <ChainValuePicker
                          field={selectedField}
                          value={step.to_value}
                          onChange={(v) => updateChainStep(i, "to_value", v)}
                          allowBlank={false}
                        />
                        <button type="button" className="text-red-500 text-sm px-2"
                                onClick={() => removeChainStep(i)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {/* ---------- Pacing ---------- */}
        <section className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">Pacing</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Updates per minute</label>
              <input type="number" min="0.1" step="0.1" className="input mt-1"
                     value={ratePerMinute} onChange={(e) => setRatePerMinute(Number(e.target.value))} />
              <div className="text-xs text-ink-400 mt-1">
                At 1/min, 30K items takes ~11 weeks. At 5/min, ~2.2 weeks.
              </div>
            </div>
            <div>
              <label className="label">Timezone</label>
              <input className="input mt-1" value={tz} onChange={(e) => setTz(e.target.value)} />
            </div>
            <div>
              <label className="label">Business hours start</label>
              <input type="time" className="input mt-1" value={bizStart} onChange={(e) => setBizStart(e.target.value)} />
            </div>
            <div>
              <label className="label">Business hours end</label>
              <input type="time" className="input mt-1" value={bizEnd} onChange={(e) => setBizEnd(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={skipWeekends} onChange={(e) => setSkipWeekends(e.target.checked)} />
              Skip weekends
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={skipHolidays} onChange={(e) => setSkipHolidays(e.target.checked)} />
              Skip US holidays
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={randomize} onChange={(e) => setRandomize(e.target.checked)} />
              Randomize within each minute
            </label>
          </div>

          <div>
            <label className="label">Custom skip dates (YYYY-MM-DD, comma-separated)</label>
            <input className="input mt-1" placeholder="e.g. 2026-07-04, 2026-12-24"
                   value={customSkipDates} onChange={(e) => setCustomSkipDates(e.target.value)} />
          </div>
        </section>

        {/* ---------- Submit ---------- */}
        {saveErr && <div className="text-sm text-red-600">{saveErr}</div>}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button className="btn-secondary" disabled={saving} onClick={() => onCreateDraft(false)}>
            Save as draft
          </button>
          <button className="btn-primary" disabled={saving} onClick={() => onCreateDraft(true)}>
            {saving ? "Saving…" : "Create & launch"}
          </button>
        </div>
      </main>
    </div>
  );
}

// ============================================================
// ChainValuePicker — dropdown for enum, text input otherwise
// ============================================================
function ChainValuePicker({
  field, value, onChange, allowBlank,
}: {
  field: Field;
  value: number | null;
  onChange: (v: number | null) => void;
  allowBlank: boolean;
}) {
  if (field.field_type === "enum") {
    return (
      <select
        className="input flex-1"
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      >
        {allowBlank && <option value="">(blank)</option>}
        {!allowBlank && <option value="">— pick —</option>}
        {(field.options || []).map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="input flex-1"
      value={value === null ? "" : String(value)}
      placeholder={allowBlank ? "(blank)" : ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}
