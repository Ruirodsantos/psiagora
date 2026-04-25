#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Psiagora — setup do ambiente local (Valet + PHP + Composer)
#  Correr uma vez: bash ~/Sites/Psiagora/setup-local.sh
# ─────────────────────────────────────────────────────────────
set -e

echo ""
echo "▸ 1/5  A verificar Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  echo "   Homebrew em falta. A instalar (vai pedir a tua password)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # adicionar brew ao PATH na sessao actual
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
else
  echo "   OK ($(brew --version | head -1))"
fi

echo ""
echo "▸ 2/5  A instalar PHP e Composer..."
brew install php composer

echo ""
echo "▸ 3/5  A instalar Laravel Valet..."
composer global require laravel/valet
# garantir que o bin global do composer esta no PATH
COMP_BIN="$(composer global config bin-dir --absolute -q)"
export PATH="$COMP_BIN:$PATH"

# adicionar ao perfil da shell se ainda nao estiver
SHELL_RC="$HOME/.zshrc"
[[ "$SHELL" == *"bash"* ]] && SHELL_RC="$HOME/.bash_profile"
if ! grep -q "composer/vendor/bin" "$SHELL_RC" 2>/dev/null; then
  echo "export PATH=\"$COMP_BIN:\$PATH\"" >> "$SHELL_RC"
  echo "   (PATH adicionado a $SHELL_RC)"
fi

valet install

echo ""
echo "▸ 4/5  A registar a pasta ~/Sites com Valet..."
cd ~/Sites
valet park
# usar o dominio .test (valet nao resolve .com)
valet domain test >/dev/null 2>&1 || true

echo ""
echo "▸ 5/5  A instalar dependencias do Psiagora (Stripe, Google, PHPMailer)..."
cd ~/Sites/Psiagora
composer install --no-interaction

echo ""
echo "─────────────────────────────────────────────────────────"
echo "  PRONTO. Abre no browser:  http://psiagora.test/agendar.html"
echo "─────────────────────────────────────────────────────────"
echo ""
echo "Nota: o Valet serve com o dominio .test, nao .com."
echo "Se quiseres usar psiagora.com localmente, adiciona ao /etc/hosts:"
echo "   127.0.0.1  psiagora.com"
echo "e corre:  valet link psiagora  (mas .test e o padrao recomendado)"
echo ""
