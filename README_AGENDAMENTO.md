# Psiagora — Agendamento nativo (substitui o Calendly)

Sistema de marcação de consultas feito directamente na página, sem dependências externas pagas. Funciona com:

- **Stripe Checkout** para pagar antes de confirmar (evita no-shows).
- **Google Calendar** como fonte da disponibilidade (o psicólogo bloqueia horas no Calendar dele → desaparecem do site automaticamente).
- **Ficheiro JSON** (`data/bookings.json`) para o histórico local das marcações.
- **PHPMailer** para emails de confirmação (cliente + psicólogo).

---

## Arquitectura

```
agendar.html               → UI (calendário + slots + formulário)
config.php                 → TODA a configuração (horários, preços, credenciais)
api/availability.php       → GET: devolve slots livres do mês
api/book.php               → POST: reserva 10 min + cria Stripe Checkout
api/webhook.php            → Stripe → confirma, grava, cria evento GCal, envia emails
sucesso.php / erro.php     → Páginas de retorno
lib/helpers.php            → Funções partilhadas
data/bookings.json         → Marcações confirmadas (auto-criado)
data/holds.json            → Reservas pendentes (TTL 10 min, auto-criado)
secrets/                   → Colocar aqui o service account JSON do Google
```

---

## Fluxo

1. Paciente abre `/agendar.html` → vê calendário com dias disponíveis.
2. Escolhe dia → vê horas livres (`api/availability.php` cruza horário base + Google Calendar + bookings + holds).
3. Escolhe hora + preenche dados → `api/book.php` cria *hold* de 10 min e gera sessão Stripe.
4. Paciente é redireccionado para Stripe Checkout.
5. Paga → Stripe chama `api/webhook.php` → hold converte-se em booking, evento criado no Google Calendar, emails enviados.
6. Paciente aterra em `/sucesso.php` com confirmação.

Se não pagar em 10 min, o hold expira sozinho e o slot volta a ficar disponível.

---

## Setup passo-a-passo

### 1. Composer (bibliotecas PHP)

No servidor, dentro da pasta do site:

```bash
composer install
```

Isto instala `stripe/stripe-php`, `google/apiclient` e `phpmailer/phpmailer` em `vendor/`. Se o alojamento não tiver Composer CLI, corre `composer install` localmente e sobe a pasta `vendor/` por FTP.

### 2. Stripe

1. Cria conta em https://stripe.com (ou usa a que já existe para o `checkout.php`).
2. Copia **Secret Key** e **Publishable Key** de https://dashboard.stripe.com/apikeys.
3. Em **Webhooks** (https://dashboard.stripe.com/webhooks) adiciona endpoint:
   - URL: `https://psiagora.com/api/webhook.php`
   - Eventos: `checkout.session.completed`, `checkout.session.expired`
4. Copia o **Signing secret** do webhook (`whsec_...`).
5. Em `config.php` preenche `stripe.secret_key`, `stripe.publishable_key`, `stripe.webhook_secret`.

> **Dica:** em vez de colar as chaves no ficheiro, define variáveis de ambiente `STRIPE_SECRET_KEY`, `STRIPE_PUBLIC_KEY`, `STRIPE_WEBHOOK_SECRET` — o `config.php` já as lê automaticamente.

### 3. Google Calendar API

1. Abre https://console.cloud.google.com/ → **New Project** → `Psiagora`.
2. **APIs & Services → Library** → activa **Google Calendar API**.
3. **IAM & Admin → Service Accounts → Create service account**.
   - Nome: `psiagora-agenda`.
4. Na aba **Keys → Add key → JSON** → descarrega o ficheiro.
5. Coloca esse ficheiro em `secrets/google-service-account.json` no servidor.
6. Abre o Google Calendar do psicólogo → Definições do calendário → **Partilhar com pessoas específicas** → adiciona o email do service account (vem dentro do JSON, campo `client_email`) com permissão **"Fazer alterações nos eventos"**.
7. Em `config.php` → `google_calendar.calendar_id`: põe o email do calendário (em "Integrar calendário" → ID do calendário). Podes manter `primary` se usares a conta do próprio service account.

A partir daqui:
- Sempre que o psicólogo cria um evento no seu Calendar (férias, outra reunião, almoço), esse slot desaparece automaticamente do site.
- Quando há uma marcação nova no site, é criado um evento no Calendar dele com os dados do cliente.

### 4. Email (SMTP)

Em `config.php > email` preenche:
- `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_secure`
- `from_email`: o email remetente (tem de estar autorizado no servidor SMTP)
- `psicologo`: email que recebe aviso de cada nova marcação

Sugestões de SMTP:
- **Gmail Workspace**: `smtp.gmail.com:587`, app password
- **Zoho Mail**: `smtp.zoho.com:465` (ssl)
- **SMTP2GO** ou **Brevo**: bom para volumes altos

### 5. Permissões de ficheiros

```bash
chmod 750 data/ secrets/
chmod 640 data/*.json
```

O webserver precisa de conseguir **escrever** em `data/` (user `www-data` ou equivalente). O browser **nunca** deve conseguir aceder a `data/` nem a `secrets/` — os ficheiros `.htaccess` já bloqueiam o acesso directo no Apache.

**Se usares Nginx**, adiciona ao config do site:

```nginx
location ~ ^/(data|secrets)/ { deny all; return 404; }
```

### 6. Ajustar horário e preço

Abre `config.php`:

```php
'sessao' => [
    'duracao_min' => 50,
    'preco_cents' => 6000,    // 60,00 EUR
    ...
],
'horario' => [
    1 => ['09:00','10:00', ...],   // Seg
    ...
],
'feriados' => ['2026-04-25', ...],
```

É o único ficheiro a tocar para mudar horários/preço.

### 7. Remover o Calendly

- Cancelar subscrição em https://calendly.com/account/billing.
- Manter o event type durante 1-2 dias caso apareça alguém com link antigo.

---

## Testar

1. Coloca Stripe em **Test mode** e usa chaves `sk_test_...`.
2. Cartão de teste: `4242 4242 4242 4242`, qualquer validade futura, qualquer CVV.
3. Para testar o webhook localmente: `stripe listen --forward-to localhost/api/webhook.php`.
4. Verifica:
   - `data/bookings.json` recebe o booking.
   - Evento aparece no Google Calendar do psicólogo.
   - Cliente e psicólogo recebem email.
5. Em produção, muda para chaves `sk_live_...`.

---

## Manutenção

- **Ver marcações:** `data/bookings.json` (edita à mão se necessário, ou cria um `/admin` protegido mais tarde).
- **Cancelar uma marcação:** altera `"status"` para `"cancelled"` no JSON. O slot volta a aparecer livre.
- **Holds expirados:** são purgados automaticamente a cada pedido de disponibilidade.
- **Backup:** inclui `data/` nos backups do site.

---

## Segurança

- `secrets/` e `data/` **nunca** devem ser acessíveis via HTTP (ver passo 5).
- Nunca commitar `config.php` com credenciais reais para o Git — cria um `config.example.php` e ignora o real.
- Webhook do Stripe é verificado com signing secret (já implementado em `webhook.php`).

---

## O que ainda fica em aberto

- **Cancelamento pelo cliente:** hoje pede-se para responder ao email. Se quiseres link de cancelamento automático, adiciona um token ao email + um endpoint `api/cancel.php?token=...`.
- **Painel admin:** para listar/cancelar marcações sem tocar no JSON.
- **Reagendamento:** mesma lógica do cancelamento + re-booking.

Posso adicionar qualquer um destes quando quiseres.
