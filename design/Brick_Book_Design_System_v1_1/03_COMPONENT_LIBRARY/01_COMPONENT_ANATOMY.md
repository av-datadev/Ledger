# BRICK BOOK — COMPONENT ANATOMY v1.1

## Button
44–48px high, 10px radius. Primary = brand fill. Secondary = tonal/outlined. Tertiary = text. One primary action per region.

## Amount Input
56–64px high. Amount is the hero. Mono/tabular number. Currency integrated. Scan/voice affordances do not compete with the amount.

## Money Display
40–48px display; 24–32px section; 16–18px inline. Mono + tabular.

## Transaction Row
56–68px target height. Primary = description + amount. Secondary = date + person/category + mode. Low-frequency actions = contextual menu.

## Bill
Vendor/title + amount; date/category/line count; paid/partial/due/unmatched; source document link.

## BOQ Item
Item | Qty | Unit | Rate | Amount; extended with Received | Used | Remaining.

## Stock
Remaining quantity is primary. Received and issued are secondary. Actions: Received / Given out / History.

## Person / Vendor
Name + type; Paid + Contract + Remaining/Due where relevant; history first-class.

## Status
Short semantic state. Never rely on color alone.

## Navigation
The shipped paged 8-tab bottom navigation is a system primitive. Do not invent alternate navigation per screen. New destinations must be evaluated against it before adding a slot.

## Offline / Sync
Compact persistent indicator using human language.

## AI Review
Source → extracted values → editable review → confirm. Never present uncertain extraction as fact.
