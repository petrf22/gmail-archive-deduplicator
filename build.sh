#!/bin/bash

# Build script for Gmail Archive Deduplicator
# Usage: ./build.sh

set -e

echo "=== Gmail Archive Deduplicator - Build Script ==="
echo ""

pushd src

# Check if icons exist
if [ ! -f "icons/icon-16.png" ] || [ ! -f "icons/icon-32.png" ] || [ ! -f "icons/icon-48.png" ]; then
    echo "⚠️  VAROVÁNÍ: PNG ikony nebyly nalezeny!"
    echo "    Prosím vytvořte ikony před vytvořením .xpi balíčku"
    echo "    Viz icons/README.md pro instrukce"
    echo ""
    read -p "Pokračovat i bez ikon? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Clean old build
if [ -f "../gmail-archive-deduplicator.xpi" ]; then
    echo "🗑️  Odstraňuji starý balíček..."
    rm ../gmail-archive-deduplicator.xpi
fi

# Create XPI (which is just a ZIP file)
echo "📦 Vytvářím .xpi balíček..."
zip -r ../gmail-archive-deduplicator.xpi \
    manifest.json \
    background.js \
    popup.html \
    popup.js \
    icons/ \
    -x "*.md" "*.sh" "*.git*" "*~"

popd

echo ""
echo "✅ Hotovo!"
echo "📍 Soubor: gmail-archive-deduplicator.xpi"
echo ""
echo "Další kroky:"
echo "1. Otevřete Thunderbird"
echo "2. Stiskněte Ctrl+Shift+A"
echo "3. Ikona ozubeného kola → Install Add-on From File"
echo "4. Vyberte gmail-archive-deduplicator.xpi"
echo ""
