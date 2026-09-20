# Pantry product enrichment

VerdoFamily enriches pantry items with optional public product metadata.

## Provider

Primary provider: Open Food Facts.

- Exact barcode lookup is preferred.
- Text/name search is used only when no barcode match is available.
- Automatic association requires a high confidence score.
- Ambiguous manual matches require explicit user confirmation.
- Images are referenced by remote URL; they are not copied into VerdoFamily storage.
- The app stores only a compact technical sheet on the pantry item.

## Automatic flow

1. Receipt OCR or pantry photo identifies products.
2. Photo recognition also attempts to extract brand and EAN/UPC.
3. Up to 6 products per import are enriched automatically to keep external API traffic low.
4. Existing pantry technical sheets are reused without another network request.
5. If enrichment fails, the inventory import continues normally.

## Stored fields

Brand, barcode, remote image URL, package quantity, ingredients, allergens,
Nutri-Score, NOVA group, Eco-Score, labels/categories and selected nutrients per 100 g/ml.

Product data is external/community-maintained and can be incomplete or outdated.
