# Diner-Manager v1.2.0 for use with Cyberpunk RED
A persistent diner / restaurant / bar / food-truck / street-vendor module for Cyberpunk Red System on Foundry VTT.
## v1.2.0 — stable

- Click a menu Item's **name or image** to open its read-only description, matching Bodega 2.4.0 and Vendit 1.3.0. The Order/Buy button remains separate.
- The active GM resolves the current menu Item for players. Previewing does not charge wealth, deliver an Item, consume allowance, or change source permissions. Without a GM, only source Items the player can observe are previewable.
- Descriptions keep ordinary text/table formatting; secret/hidden blocks, scripts, active controls, and executable document links are stripped.
- Lifestyle detection matches Holophone Messenger 1.9.0: non-empty Gear marked carried, equipped, owned, or with no state; custom food packages; and Datapool/custom housing.
- Monthly cost priority: `###eb/month` in the Item name, then description, then market price. Standard food tiers retain their usual monthly fallback.
- Custom food Items require **lifestyle package**, **food lifestyle**, or **meal lifestyle** in the name/description. Their coverage rank follows the standard monthly ladder: Kibble below 300eb, Generic Prepak at 300eb, Good Prepak at 600eb, Fresh Food at 1500eb.
- Custom housing uses Holophone's housing-name terms plus a housing marker, monthly amount, or market price. Food and housing remain separate; only the selected highest food tier and highest housing cost count.
- GM Actor and Item food-tier overrides, existing menus, serving locks, and covered-order ledgers remain supported.

**Recommended optional modules:** Simple Calendar minimum **2.4.17**, verified **2.4.18**, maximum **2.4.18**; Monk's Active Tile Triggers minimum **12.01**, verified **12.02**, maximum **12.02**. These reflect our established v12 project compatibility bounds.

### Regression checklist

1. Click a name and image as GM and player, including a menu Item from a compendium or world folder the player cannot normally open. Confirm description formatting and that no order or sheet edit occurs.
2. Inspect an owned custom food package and a Datapool housing Item. Check the displayed label, food coverage, and food + housing total against their name/description/market prices.
3. Confirm ordinary paid orders, covered orders, daily allowance, and consume-to-zero serving release still work.
4. Confirm the preview follows the 2077 Cyan / 2045 Red theme, GM overrides still work, and existing Tile launchers open the menu.

## Previous v1.1.4 features

- Restyled Manager, editor, options, and player menu to share the dark neon visual language used by Bodega, Vendit, and CHOOM TRADE.
- Keeps the existing world-level era switch:
  - **2077 Cyan** — `#00FFF7`
  - **2045 Red** — `#E64539`
  - Yellow hover / hard-accent details — `#FFDD00`
- Default Diner and macro icon changed to the CPR system Koff Popper coffee icon:
  - `systems/cyberpunk-red-core/icons/compendium/cargo-containers-and-cube-hotels/koff-popper.svg`
- Existing Diners still using the old bowl/stew icon migrate to the Koff Popper icon automatically.
- Added manual Tile binding, automatic Tile creation/binding, and a reusable Monk's Active Tile Triggers helper.
- Bound-Tile management now lists every Tile/Scene, supports individual unlink, multi-selected unlink, and **Unbind All** across scenes.
- Added **Create Meal / Drink** to create a real CPR world Item as either `drug` or `gear`, then immediately add it to the Diner menu.
- Create Menu Item now uses fully themed dropdowns, a Foundry image FilePicker, and an exact-source Active Effect builder for CPR Drugs.
- New Drugs can copy one or several exact CPR Active Effects from source Drugs and explicitly designate the consumed effect.
- The creator no longer exposes Usage; Diner uses `toggled` internally for generated Gear and Drug Items.
- CPR Drug Items remain Drug Items when delivered and retain their system data and Active Effects.
- Copied Active Effects are re-pointed to the newly embedded Actor Item after delivery.

## Core behavior

- World-persistent diners and menus.
- Optional scene lock for fixed restaurants.
- Mobile vendors can remain world-wide and be bound to multiple Tiles.
- Menu categories can be populated manually or generated from RollTables.
- Category coverage rules:
  - Food lifestyle tier.
  - Total monthly lifestyle budget.
  - Always pay.
  - Always included.
- Actor food lifestyle is detected from active embedded Gear Items for Kibble, Generic Prepak, Good Prepak, Fresh Food, or custom food lifestyle packages.
- Housing is detected separately and included only for the total-monthly-budget rule.
- Orders can add the Item to Actor inventory or use chat-only delivery.
- The active GM authoritatively processes orders, wealth changes, meal allowance, and serving locks.

## Installation

1. Replace the old `Data/modules/diner-manager` folder with this `diner-manager` folder.
2. Enable **Diner™ Manager**.
3. Reload the world and hard-refresh browser clients if the old CSS remains cached.

On startup the active GM gets or refreshes these world macros:

- `Diner™ Manager`
- `Diner™ Launcher`
- `Diner™ Tile Launcher`

Existing diner data and meal-ledger data remain in their current world settings.

## Manager access

Run:

```js
game.dinerManager.openManager();
```

The module also adds **Diner™ Manager** to the GM Token controls using a coffee/mug icon.

## Manual Tile binding

1. Select exactly one Foundry Tile.
2. Open the Diner editor.
3. Press **Bind Selected Tile**.
4. In Monk's Active Tile Triggers, use an Execute Script action with:

```js
return game.dinerManager.openTile({
  args: typeof args === "undefined" ? null : args,
  tile: typeof tile === "undefined" ? null : tile,
  token: typeof token === "undefined" ? null : token,
  actor: typeof actor === "undefined" ? null : actor
});
```

You can instead execute the generated `Diner™ Tile Launcher` macro. The Tile itself stores the Diner ID in its module flags, so the same helper works for every bound Diner Tile.

A Diner can be bound to multiple Tiles. The editor lists every bound Tile with its Scene, lets the GM unlink individual Tiles, unlink multiple selected Tiles on the current canvas, or **Unbind All** across scenes. Changing the Diner ID updates its known Tile bindings. Deleting a Diner clears its known Tile flags, and deleting a Tile removes it from the Diner binding list.

## Auto Tile Binder

Open **Diner™ Options** and enable **Auto-create and bind a Diner when a newly created Tile matches a keyword**.

Default keywords:

```text
diner,restaurant,cafe,coffee,food truck,food stand,vendor
```

To define the source configuration:

1. Open a configured Diner.
2. Press **Use as Auto-Tile Template**.
3. Create a new Tile whose name or image path matches one of the configured keywords.

The module clones the template into a new scene-locked Diner, gives it a new ID, binds the Tile, and preserves the template's menu/categories. The source template is never moved or modified.

## Creating food and drink Items inside Diner Manager

Open a Diner and press **Create Meal / Drink**.

The creator makes a normal Cyberpunk RED world Item in a `Diner™ Menu Items` Item folder, then adds its UUID to the selected menu category.

The image control uses Foundry's own image FilePicker and keeps the chosen path as a Foundry-local asset path. The visible path field remains editable for established `systems/`, `modules/`, `worlds/`, or other Data paths, but external/browser URLs and `..` traversal are rejected.

### Drug — recommended for consumable food/drink

Creates a CPR Item with:

- `type: "drug"`
- `system.amount`
- `system.price.market`
- `system.usage` (`toggled`, set internally)
- `system.consumed`
- `system.brand`
- HB source / page 0

Use this for meals, coffee, cocktails, snacks, or other food/drink intended to use the CPR Drug/consumable workflow. The **Active Effects** builder discovers exact embedded Active Effects from CPR Drug Items already present in the world or current Diner menu. Each option is identified by both effect name and source Item (for example, `Drunk 1 — Purple Haze`). Add one or several effects, then mark one attached effect as **Consumed**. Diner copies the selected effect documents with their real CPR mechanical changes/flags and sets `system.consumed` to the chosen attached effect name. Fresh effect IDs are generated and origins are pointed at the newly created Item.

### Gear — persistent inventory object

Creates a CPR Item with `type: "gear"`, amount, price, brand, internally-set `toggled` usage, normal Gear installation fields, and HB source / page 0.

Use Gear when the Item is meant to remain in inventory. A lifestyle-covered Gear serving continues holding the serving lock until the Item is removed because it does not participate in the CPR Drug amount-consumption workflow.

## Active Effects and 0/0 consumables

Diner delivery clones the source Item without changing its CPR Item type or system data.

For `drug` Items:

- Remaining amount above `0` counts as an outstanding covered serving.
- Amount `0` releases the serving lock.
- A spent `0/0` Item may remain on the character sheet so its roleplay/Active Effects can remain visible.
- Active Effects are not deleted or disabled by Diner Manager.
- On delivery, copied effect origins are updated to the new embedded Actor Item.

## Lifestyle-covered meal allowance

Defaults:

- 3 covered orders per in-game day.
- Shared across all Diners.
- Previous covered serving must be consumed to `0` or removed before the next covered serving.
- Counts are stored in a GM-controlled world ledger.
- Simple Calendar date is used when available, with Foundry world time as fallback.

The GM can change the limit, scope, exhausted-limit behavior, and serving lock from **Diner™ Options**.

## Direct Diner opening

A known Diner can still be opened directly:

```js
game.dinerManager.open("YOUR-DINER-ID");
```

The generated `Diner™ Launcher` macro still accepts:

```text
id=YOUR-DINER-ID
```

## RollTable references

Accepted formats:

- RollTable UUID
- World RollTable name
- `pack.collection::Table Name`

Table results should resolve to Item documents. Text results are also searched as Item names.

## Legal / Homebrew Content Policy

This is unofficial homebrew content for use with Cyberpunk RED.

This project is provided free of charge under the R. Talsorian Games Homebrew Content Policy.

Diner Manager for use with Cyberpunk RED is unofficial content provided under the Homebrew Content Policy of R. Talsorian Games and is not approved or endorsed by RTG. This content references materials that are the property of R. Talsorian Games and its licensees.

Cyberpunk RED and related properties are the property of R. Talsorian Games and their respective licensees.
