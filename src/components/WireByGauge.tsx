import { useMemo, useState } from "react";
import { num } from "../lib/format";
import { wireByGauge, type WireLine } from "../lib/measure";
import type { BoqItem } from "../types";
import { Icon } from "./Icon";

/**
 * Every coil of wire bought, by gauge, read straight off the bills.
 *
 * Wire is bought by the coil in a dozen colours across several bills, and
 * what an electrician asks is "how much 2.5 mm have we got" — a sum nobody
 * should be doing by hand across invoices. Derived, never stored: a wire bill
 * saved, edited, deleted or synced in moves this table on the next render.
 * A gauge opens to its colours, so a missing earth (green-yellow) or neutral
 * shows up before the electrician runs short.
 */
export function WireByGauge({ items }: { items: BoqItem[] }) {
  const wire = useMemo(() => wireByGauge(items), [items]);
  const [open, setOpen] = useState<number | null>(null);

  if (!wire) return null;

  // A gauge reads as printed — 2.5 mm, never num()'s "2.50".
  const mm = (n: number) => `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })} mm`;
  const coils = (l: WireLine) => (l.coils > 0 ? num(l.coils) : "—");
  const metres = (l: WireLine) => (l.metres > 0 ? num(l.metres) : "—");

  return (
    <section className="mt-2 mb-4">
      <h3 className="eyebrow mb-2">Wire by gauge</h3>
      <div className="card overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-rule text-left text-ink-soft">
              <th className="px-2 py-1.5 font-medium">Gauge</th>
              <th className="px-2 py-1.5 font-medium text-right">Coils</th>
              <th className="px-2 py-1.5 font-medium text-right">Metres</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {wire.gauges.map((g) => {
              const isOpen = open === g.gauge;
              return [
                <tr key={g.gauge}>
                  <td className="p-0">
                    <button
                      className="w-full min-h-[44px] px-2 flex items-center gap-1.5 text-left"
                      aria-expanded={isOpen}
                      aria-label={`${mm(g.gauge)}, ${isOpen ? "hide" : "show"} colours`}
                      onClick={() => setOpen(isOpen ? null : g.gauge)}
                    >
                      <Icon
                        name="chevron"
                        size={12}
                        className={`text-ink-faint shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                      />
                      <span className="money">{mm(g.gauge)}</span>
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right money">{coils(g)}</td>
                  <td className="px-2 py-1.5 text-right money">{metres(g)}</td>
                </tr>,
                ...(isOpen
                  ? g.colours.map((c) => (
                      <tr key={`${g.gauge}-${c.colour ?? "none"}`} className="bg-paper-2 text-ink-soft">
                        <td className="pl-8 pr-2 py-1.5">{c.colour ?? "Colour not on bill"}</td>
                        <td className="px-2 py-1.5 text-right money">{coils(c)}</td>
                        <td className="px-2 py-1.5 text-right money">{metres(c)}</td>
                      </tr>
                    ))
                  : []),
              ];
            })}
            <tr className="font-semibold">
              <td className="px-2 py-2">Total</td>
              <td className="px-2 py-2 text-right money">{coils(wire)}</td>
              <td className="px-2 py-2 text-right money">{metres(wire)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {wire.unmeasured > 0 && (
        <p className="text-[11px] text-ink-soft mt-1.5 px-1">
          {wire.unmeasured} line{wire.unmeasured === 1 ? " gives" : "s give"} no
          metres per coil, so the metres leave {wire.unmeasured === 1 ? "it" : "them"} out.
          Edit the bill to add it.
        </p>
      )}
    </section>
  );
}
