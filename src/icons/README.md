# Ikony

Před vytvořením .xpi balíčku je potřeba vytvořit PNG ikony.

## Možnosti vytvoření ikon:

### 1. Použití online nástroje (nejjednodušší)
- Navštivte https://www.favicon-generator.org/
- Nahrajte obrázek nebo použijte připravené `icon.svg`
- Stáhněte vygenerované ikony různých velikostí
- Přejmenujte je na:
  - `icon-16.png` (16x16 px)
  - `icon-32.png` (32x32 px)
  - `icon-48.png` (48x48 px)

### 2. Použití Inkscape (open-source)
```bash
inkscape icon.svg --export-filename=icon-16.png -w 16 -h 16
inkscape icon.svg --export-filename=icon-32.png -w 32 -h 32
inkscape icon.svg --export-filename=icon-48.png -w 48 -h 48
```

### 3. Použití ImageMagick
```bash
convert icon.svg -resize 16x16 icon-16.png
convert icon.svg -resize 32x32 icon-32.png
convert icon.svg -resize 48x48 icon-48.png
```

### 4. Vlastní design
Můžete vytvořit vlastní ikony v jakémkoliv grafickém editoru (GIMP, Photoshop, atd.)

## Požadavky
- Formát: PNG
- Průhledné pozadí (doporučeno)
- Velikosti: 16x16, 32x32, 48x48 pixelů
