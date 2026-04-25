#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Psiagora — servidor de desenvolvimento local
#  Duplo-clique neste ficheiro para arrancar.
#  Fecha a janela do Terminal para parar.
# ─────────────────────────────────────────────────────────────
set -e

cd "$(dirname "$0")"

echo ""
echo "▸ A verificar dependências (vendor/)..."
if [[ ! -f vendor/autoload.php ]]; then
  echo "   vendor/ em falta. A correr composer install..."
  composer install --no-interaction
else
  echo "   OK"
fi

echo ""
echo "─────────────────────────────────────────────────────────"
echo "  Servidor a correr em:  http://localhost:8080"
echo "  Página de agendamento: http://localhost:8080/agendar.html"
echo "─────────────────────────────────────────────────────────"
echo ""
echo "  Fecha esta janela (ou Ctrl+C) para parar."
echo ""

php -S localhost:8080
