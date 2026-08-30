# Changelog

## 1.1.4
- Added the missing `relationships.systems` manifest requirement for Cyberpunk RED (`cyberpunk-red-core`, minimum 0.92.1, verified 0.92.4) so the module no longer offers itself for install on unrelated systems.
- No runtime behavior changes.

## 1.1.3
- Added a bound-Tile roster to each Diner showing Tile name, Scene name, and UUID.
- Added per-Tile unlink controls plus **Unbind All** for mobile vendors spanning multiple scenes.
- **Unbind Selected Tile(s)** now accepts multiple controlled Tiles on the current canvas.
- Added public API helpers `game.dinerManager.unbindSelectedTiles(id)` and `game.dinerManager.unbindAllTiles(id)`.
- Reworked Create Menu Item Active Effects to use exact source Item/effect templates instead of ambiguous effect-name-only selection.
- GMs can attach multiple copied CPR Active Effects to a newly created Drug and explicitly choose which attached effect becomes `system.consumed`.
- Copied Active Effects retain their mechanical changes, CPR flags, transfer settings, duration metadata, image, and other effect data while receiving fresh IDs and the new Item as their origin.
- Prevents attaching two different source effects with the same effect name to one generated Drug, avoiding ambiguous CPR consumed-effect resolution.
- Corrected the internal module runtime version string to match the release version.

## 1.1.2
- Fixed the Create Menu Item image Browse button on Foundry VTT 12 by resolving the core `FilePicker` lexical global and opening it with `render(true)`.
- Added compatibility fallbacks for namespaced FilePicker exposure.
- Hardened all custom Create Menu Item dropdown trigger/menu/option styling against Foundry/native button backgrounds so the controls stay in the Diner neon chrome.

## 1.1.1

- Replaced Create Menu Item native dropdowns with Diner-themed dark-neon dropdown controls.
- Added a Foundry FilePicker Browse control and image preview for menu Item images.
- Rejects external/browser image URLs and parent-directory traversal in newly created menu Items; uses Foundry-local asset paths.
- Removed the Usage field from Create Menu Item; generated CPR Gear and Drug Items use `system.usage: "toggled"` internally.
- Changed Consumed Effect to a dropdown populated from existing CPR Drug consumed/effect names in the world and current Diner menu, with `None` always available.
- Consumed Effect selection stores only the effect name and never copies mechanics from another Drug Item.

## 1.1.0

- Unified Diner UI with Bodega™ / Vendit™ / CHOOM TRADE dark-neon chrome.
- Changed the default Diner and generated macro icon to CPR Koff Popper.
- Added selected-Tile binding and unbinding.
- Added `game.dinerManager.openTile(context)` and generated `Diner™ Tile Launcher` helper macro.
- Added optional keyword-driven Auto Tile Binder with configurable template Diner.
- Added Tile-binding cleanup when Diner IDs change, Diners are deleted, or Tiles are deleted.
- Added GM Token-controls Diner Manager button.
- Added **Create Meal / Drink** to create real CPR `drug` or `gear` world Items and add them directly to a Diner menu.
- Added Item-type badges to menu editing rows when type metadata is available.
- Preserved CPR Drug data and Active Effects on delivery and refreshed copied Active Effect origins to the new embedded Actor Item.
- Migrates legacy bowl/stew Diner images to the CPR Koff Popper icon.

## 1.0.4

- Covered-serving lock treats CPR Drug amount `0` as consumed while allowing the spent Item and its Active Effects to remain on the Actor sheet.
