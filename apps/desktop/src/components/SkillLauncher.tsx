import { useEffect, useMemo, useState } from "react";
import type { SkillCard, SkillInput } from "../api";
import { listSkills, prefetchSessionContext } from "../api";
import { useUiStore } from "../store";

function skillTag(path: string): string[] {
  const base = path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
  return base ? [base] : [];
}

// ---------------------------------------------------------------------------
// SkillFormModal
// ---------------------------------------------------------------------------

interface SkillFormModalProps {
  skill: SkillCard;
  onCancel: () => void;
  onSubmit: (formData: Record<string, string>) => void;
}

function SkillFormModal({ skill, onCancel, onSubmit }: SkillFormModalProps) {
  const initValues = Object.fromEntries(
    skill.inputs.map((f) => [f.key, f.default ?? (f.type === "checkbox" ? "false" : "")]),
  );
  const [values, setValues] = useState<Record<string, string>>(initValues);

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  const isValid = skill.inputs
    .filter((f) => f.required)
    .every((f) => {
      const v = values[f.key] ?? "";
      return f.type === "checkbox" ? v === "true" : v.trim() !== "";
    });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onSubmit(values);
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-dialog skill-form-dialog">
        <h3 className="modal-title">{skill.title}</h3>
        <p className="muted modal-subtitle">{skill.relativePath}</p>
        <form onSubmit={handleSubmit} className="skill-form">
          {skill.inputs.map((field) => (
            <SkillFormField
              key={field.key}
              field={field}
              value={values[field.key] ?? ""}
              onChange={(v) => setValue(field.key, v)}
            />
          ))}
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!isValid}>
              Launch
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SkillFormFieldProps {
  field: SkillInput;
  value: string;
  onChange: (v: string) => void;
}

function SkillFormField({ field, value, onChange }: SkillFormFieldProps) {
  const id = `skill-field-${field.key}`;
  return (
    <div className="skill-form-field">
      <label htmlFor={id} className="skill-form-label">
        {field.label}
        {field.required && <span className="required-mark"> *</span>}
      </label>
      {field.type === "select" && field.options ? (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="skill-form-input">
          <option value="">— select —</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <label className="skill-form-checkbox-label">
          <input
            id={id}
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
          <span>{field.placeholder ?? field.label}</span>
        </label>
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={field.placeholder ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="skill-form-input"
          autoComplete="off"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillLauncher
// ---------------------------------------------------------------------------

export function SkillLauncher() {
  const [skills, setSkills] = useState<SkillCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pendingSkill, setPendingSkill] = useState<SkillCard | null>(null);
  const addTermSession = useUiStore((s) => s.addTermSession);

  useEffect(() => {
    listSkills()
      .then(setSkills)
      .catch((e) => setErr(String(e)));
  }, []);

  const grouped = useMemo(() => {
    const m = new Map<string, SkillCard[]>();
    for (const s of skills) {
      const k = s.category || "general";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(s);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [skills]);

  function handleCardClick(skill: SkillCard) {
    if (skill.inputs.length > 0) {
      setPendingSkill(skill);
    } else {
      void launchDirect(skill.relativePath, skill.title);
    }
  }

  async function launchDirect(skillPath: string, title: string, formData?: Record<string, string>) {
    setErr(null);
    try {
      await prefetchSessionContext({
        skillRelativePath: skillPath,
        recallTags: skillTag(skillPath),
        limit: 15,
        formData: formData ?? null,
      });
      addTermSession(title);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function launchBare() {
    setErr(null);
    try {
      await prefetchSessionContext({
        skillRelativePath: "",
        recallTags: [],
        limit: 15,
      });
      addTermSession("Agent");
    } catch (e) {
      setErr(String(e));
    }
  }

  function handleFormSubmit(formData: Record<string, string>) {
    if (!pendingSkill) return;
    const skill = pendingSkill;
    setPendingSkill(null);
    void launchDirect(skill.relativePath, skill.title, formData);
  }

  if (err) return <p className="error">{err}</p>;

  return (
    <div className="panel">
      {pendingSkill && (
        <SkillFormModal
          skill={pendingSkill}
          onCancel={() => setPendingSkill(null)}
          onSubmit={handleFormSubmit}
        />
      )}
      <div className="row-between">
        <h2>Skills</h2>
        <button type="button" className="primary" onClick={() => void launchBare()}>
          Launch Claude (no skill)
        </button>
      </div>
      <p className="muted">
        Click a card to prefetch memories into <code>.session/SESSION_CONTEXT.md</code> and open the embedded
        terminal.
      </p>
      {grouped.map(([cat, items]) => (
        <section key={cat} className="skill-section">
          <h3>{cat}</h3>
          <div className="skill-grid">
            {items.map((s) => (
              <button
                key={s.relativePath}
                type="button"
                className="skill-card"
                onClick={() => handleCardClick(s)}
              >
                <div className="skill-title">{s.title}</div>
                <div className="skill-path muted">{s.relativePath}</div>
                {s.inputs.length > 0 && (
                  <div className="skill-form-badge">form</div>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
      {!skills.length ? <p className="muted">No skills found under vault/skills.</p> : null}
    </div>
  );
}
