import type { GenerationBriefDraft } from "../types/generationBrief";

export interface GenerationBriefFieldsProps {
  value: GenerationBriefDraft;
  onChange: (value: GenerationBriefDraft) => void;
  disabled?: boolean;
  idPrefix: string;
}

export function GenerationBriefFields({
  value,
  onChange,
  disabled,
  idPrefix,
}: GenerationBriefFieldsProps) {
  function update<Key extends keyof GenerationBriefDraft>(
    key: Key,
    next: GenerationBriefDraft[Key],
  ) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="generation-brief__fields">
      <label htmlFor={`${idPrefix}-role`}>
        <span>Target role *</span>
        <input
          disabled={disabled}
          id={`${idPrefix}-role`}
          maxLength={200}
          onChange={(event) => update("targetRole", event.target.value)}
          placeholder="e.g. Senior Data Engineer"
          value={value.targetRole}
        />
      </label>
      <label
        className="generation-brief__wide"
        htmlFor={`${idPrefix}-background`}
      >
        <span>Project or job background *</span>
        <textarea
          disabled={disabled}
          id={`${idPrefix}-background`}
          maxLength={10000}
          onChange={(event) => update("projectBackground", event.target.value)}
          placeholder="Paste the project description or job description here."
          rows={5}
          value={value.projectBackground}
        />
      </label>
      <label htmlFor={`${idPrefix}-skills`}>
        <span>Required skills</span>
        <textarea
          disabled={disabled}
          id={`${idPrefix}-skills`}
          onChange={(event) => update("requiredSkills", event.target.value)}
          placeholder="Python, Spark, AWS"
          rows={3}
          value={value.requiredSkills}
        />
        <small>Separate items with commas or new lines.</small>
      </label>
      <label htmlFor={`${idPrefix}-emphasis`}>
        <span>What should the CV emphasize?</span>
        <textarea
          disabled={disabled}
          id={`${idPrefix}-emphasis`}
          onChange={(event) => update("emphasis", event.target.value)}
          placeholder="Relevant projects, architecture leadership"
          rows={3}
          value={value.emphasis}
        />
        <small>Only supported candidate facts will be used.</small>
      </label>
      <label htmlFor={`${idPrefix}-language`}>
        <span>Output language *</span>
        <select
          disabled={disabled}
          id={`${idPrefix}-language`}
          onChange={(event) => update("language", event.target.value)}
          value={value.language}
        >
          <option>English</option>
          <option>German</option>
          <option>Chinese</option>
          <option>French</option>
          <option>Spanish</option>
        </select>
      </label>
      <label
        className="generation-brief__wide"
        htmlFor={`${idPrefix}-instructions`}
      >
        <span>Additional instructions</span>
        <textarea
          disabled={disabled}
          id={`${idPrefix}-instructions`}
          maxLength={4000}
          onChange={(event) =>
            update("additionalInstructions", event.target.value)
          }
          placeholder="e.g. De-emphasize frontend work; keep the tone concise."
          rows={3}
          value={value.additionalInstructions}
        />
      </label>
    </div>
  );
}
