import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, updateSettings } from "../db";
import { STATES, CITIES_BY_STATE } from "../../shared/locations";

/**
 * House/project address for the Dashboard: shows the saved address with an
 * inline editor (free-text address, a state dropdown, and a city dropdown whose
 * suggestions follow the chosen state — a city not listed can still be typed).
 */
export function AddressCard() {
  const settings = useLiveQuery(() => db.settings.get("app"), []);
  const homeAddress = settings?.homeAddress ?? "";
  const state = settings?.state ?? "";
  const city = settings?.city ?? "";

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ homeAddress: "", state: "", city: "" });

  const openEditor = () => {
    setForm({ homeAddress, state, city });
    setEditing(true);
  };

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    await updateSettings({
      homeAddress: form.homeAddress.trim(),
      state: form.state.trim(),
      city: form.city.trim(),
    });
    setEditing(false);
  };

  const hasAddress = !!(homeAddress || state || city);
  const line = [homeAddress, city, state].filter(Boolean).join(", ");
  const cityOptions = CITIES_BY_STATE[form.state] ?? [];

  if (editing) {
    return (
      <div className="px-4 pt-4">
        <div className="bg-surface border border-rule rounded-md p-3 space-y-3">
          <div>
            <label className="field-label" htmlFor="addr-line">
              House address
            </label>
            <textarea
              id="addr-line"
              className="input min-h-20"
              placeholder="Plot / house no., street, area…"
              value={form.homeAddress}
              onChange={(e) => set("homeAddress", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="addr-state">
                State
              </label>
              <select
                id="addr-state"
                className="input"
                value={form.state}
                onChange={(e) =>
                  // Changing state clears a city that no longer fits.
                  setForm((f) => ({ ...f, state: e.target.value, city: "" }))
                }
              >
                <option value="">— select —</option>
                {STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="addr-city">
                City
              </label>
              <input
                id="addr-city"
                className="input"
                list="city-options"
                placeholder={form.state ? "Pick or type" : "Choose a state first"}
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              />
              <datalist id="city-options">
                {cityOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              className="btn btn-primary flex-1 !py-2 !text-[13px]"
              onClick={() => void save()}
            >
              Save
            </button>
            <button
              className="btn flex-1 !py-2 !text-[13px]"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasAddress) {
    return (
      <div className="px-4 pt-4">
        <button
          className="w-full bg-surface border border-dashed border-rule rounded-md px-3 py-2.5 text-[13px] text-ink-soft text-left active:bg-ink/5"
          onClick={openEditor}
        >
          + Add the house address
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <button
        className="w-full bg-surface border border-rule rounded-md p-3 text-left active:bg-ink/5"
        onClick={openEditor}
      >
        <div className="text-[11px] uppercase tracking-[0.15em] text-ink-soft mb-1">
          House address
        </div>
        <div className="text-sm">🏠 {line}</div>
      </button>
    </div>
  );
}
