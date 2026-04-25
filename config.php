<?php
/**
 * ──────────────────────────────────────────────────────────────
 *  PSIAGORA — Configuracao central do agendamento
 *  Edita este ficheiro para mudar horarios, preco, credenciais.
 *  NAO commitar este ficheiro com credenciais reais para git.
 * ──────────────────────────────────────────────────────────────
 */

return [

    // ── SESSAO ──────────────────────────────────────────────────
    'sessao' => [
        'nome'           => 'Consulta Psiagora',
        'duracao_min'    => 50,     // minutos da sessao
        'buffer_min'     => 10,     // minutos entre sessoes (descanso)
        'preco_cents'    => 6000,   // 60,00 EUR em centimos
        'moeda'          => 'eur',
        'timezone'       => 'Europe/Lisbon',
        'antecedencia_min_h'  => 24,   // horas minimas antes da consulta (ex: nao marcar para hoje)
        'janela_visivel_dias' => 45,   // quantos dias no futuro mostrar no calendario
    ],

    // ── HORARIO DE TRABALHO ─────────────────────────────────────
    // Dias da semana: 1=Seg ... 7=Dom
    // Para cada dia: lista de horas de inicio (formato "HH:MM") dos slots disponiveis
    // DEIXA VAZIO ([]) o dia em que nao atendes
    'horario' => [
        1 => ['09:00','10:00','11:00','14:00','15:00','16:00','17:00','18:00'],  // Seg
        2 => ['09:00','10:00','11:00','14:00','15:00','16:00','17:00','18:00'],  // Ter
        3 => ['09:00','10:00','11:00','14:00','15:00','16:00','17:00','18:00'],  // Qua
        4 => ['09:00','10:00','11:00','14:00','15:00','16:00','17:00','18:00'],  // Qui
        5 => ['09:00','10:00','11:00','14:00','15:00','16:00','17:00','18:00'],  // Sex
        6 => [],  // Sab
        7 => [],  // Dom
    ],

    // Feriados fixos ou datas bloqueadas (YYYY-MM-DD)
    'feriados' => [
        '2026-04-25', // Dia da Liberdade
        '2026-05-01', // Dia do Trabalhador
        '2026-06-10', // Dia de Portugal
        '2026-08-15', // Assuncao
        '2026-10-05', // Implantacao da Republica
        '2026-11-01', // Todos os Santos
        '2026-12-01', // Restauracao da Independencia
        '2026-12-08', // Imaculada Conceicao
        '2026-12-25', // Natal
    ],

    // ── GOOGLE CALENDAR (para ler disponibilidade) ──────────────
    // 1) Cria service account em https://console.cloud.google.com/
    // 2) Descarrega o JSON e coloca-o no servidor (fora do webroot se possivel)
    // 3) Partilha o Calendar do psicologo com o email do service account (permissao: "ver tudo")
    'google_calendar' => [
        'service_account_json' => __DIR__ . '/secrets/google-service-account.json',
        'calendar_id'          => 'primary',   // ou o email do calendario ex: "consultas@psiagora.com"
        'sync_write'           => true,        // criar evento no Calendar quando ha marcacao confirmada
    ],

    // ── STRIPE ──────────────────────────────────────────────────
    // Vai a https://dashboard.stripe.com/apikeys
    'stripe' => [
        'secret_key'      => getenv('STRIPE_SECRET_KEY') ?: 'sk_test_TROCA_PELA_TUA_SECRET_KEY',
        'publishable_key' => getenv('STRIPE_PUBLIC_KEY') ?: 'pk_test_TROCA_PELA_TUA_PUBLIC_KEY',
        'webhook_secret'  => getenv('STRIPE_WEBHOOK_SECRET') ?: 'whsec_TROCA_PELO_TEU_WEBHOOK_SECRET',
        'success_url'     => 'https://psiagora.com/sucesso.php?session_id={CHECKOUT_SESSION_ID}',
        'cancel_url'      => 'https://psiagora.com/erro.php',
    ],

    // ── EMAIL (SMTP) ────────────────────────────────────────────
    // Recomendacao: usar o SMTP do teu dominio (ex: Gmail Workspace, Zoho, SMTP2GO)
    'email' => [
        'from_name'    => 'Psiagora',
        'from_email'   => 'agendamentos@psiagora.com',
        'reply_to'     => 'agendamentos@psiagora.com',
        'psicologo'    => 'rui@adventishub.com', // recebe aviso a cada marcacao
        'smtp_host'    => 'smtp.exemplo.com',
        'smtp_port'    => 587,
        'smtp_user'    => 'agendamentos@psiagora.com',
        'smtp_pass'    => getenv('SMTP_PASS') ?: 'TROCA_PELA_PASSWORD_SMTP',
        'smtp_secure'  => 'tls',  // 'tls' ou 'ssl'
    ],

    // ── ARMAZENAMENTO ──────────────────────────────────────────
    'storage' => [
        'bookings_file' => __DIR__ . '/data/bookings.json',
        'holds_file'    => __DIR__ . '/data/holds.json',      // reservas pendentes (10min)
        'hold_ttl_min'  => 10,
    ],
];
