<?php
/**
 * Webhook do Stripe — confirma a marcacao depois do pagamento.
 *
 * Configura em https://dashboard.stripe.com/webhooks:
 *   Endpoint:  https://psiagora.com/api/webhook.php
 *   Evento:    checkout.session.completed  (+ checkout.session.expired para limpeza)
 * E coloca o signing secret em config.php > stripe.webhook_secret
 */
require __DIR__ . '/../lib/helpers.php';

$cfg = load_config();

if (!file_exists(__DIR__ . '/../vendor/autoload.php')) {
    http_response_code(500); echo 'vendor missing'; exit;
}
require __DIR__ . '/../vendor/autoload.php';

\Stripe\Stripe::setApiKey($cfg['stripe']['secret_key']);

$payload   = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

try {
    $event = \Stripe\Webhook::constructEvent($payload, $sigHeader, $cfg['stripe']['webhook_secret']);
} catch (Throwable $e) {
    http_response_code(400); echo 'Bad signature'; exit;
}

if ($event->type === 'checkout.session.completed') {
    $session = $event->data->object;
    $meta    = $session->metadata ?? null;
    if (!$meta) { http_response_code(200); echo 'no meta'; exit; }

    $holdId = $meta->hold_id ?? null;
    $date   = $meta->date    ?? null;
    $time   = $meta->time    ?? null;
    if (!$date || !$time) { http_response_code(200); echo 'missing'; exit; }

    // Remove hold
    $holds = read_json($cfg['storage']['holds_file']);
    $holdData = null;
    $holds['items'] = array_values(array_filter($holds['items'] ?? [], function($h) use ($holdId, &$holdData) {
        if (($h['id'] ?? '') === $holdId) { $holdData = $h; return false; }
        return true;
    }));
    write_json($cfg['storage']['holds_file'], $holds);

    // Cria booking definitivo (idempotente: nao duplica se ja existir com este session id)
    $bookings = read_json($cfg['storage']['bookings_file']);
    $bookings['items'] = $bookings['items'] ?? [];
    foreach ($bookings['items'] as $b) {
        if (($b['stripe_session'] ?? '') === $session->id) {
            http_response_code(200); echo 'already processed'; exit;
        }
    }

    $booking = [
        'id'             => bin2hex(random_bytes(8)),
        'date'           => $date,
        'time'           => $time,
        'nome'           => $meta->nome     ?? ($holdData['nome']     ?? ''),
        'email'          => $meta->email    ?? ($holdData['email']    ?? ''),
        'telefone'       => $meta->telefone ?? ($holdData['telefone'] ?? ''),
        'mensagem'       => $holdData['mensagem'] ?? '',
        'status'         => 'confirmed',
        'stripe_session' => $session->id,
        'amount_cents'   => $session->amount_total ?? $cfg['sessao']['preco_cents'],
        'created_at'     => date('c'),
    ];

    // Evento no Google Calendar (best-effort)
    $booking['gcal_event_id'] = google_create_event($booking);

    $bookings['items'][] = $booking;
    write_json($cfg['storage']['bookings_file'], $bookings);

    // Emails (best-effort)
    $quando = fmt_pt($date, $time);
    $preco  = number_format(($booking['amount_cents'] / 100), 2, ',', '.');

    // cliente
    send_email(
        $booking['email'],
        'Consulta confirmada — ' . $quando,
        "<p>Ola {$booking['nome']},</p>".
        "<p>A sua consulta foi <strong>confirmada</strong> para <strong>$quando</strong>.</p>".
        "<p>Duracao: {$cfg['sessao']['duracao_min']} minutos &nbsp;·&nbsp; Valor: {$preco} EUR</p>".
        "<p>Iremos enviar o link da videochamada proximo do horario. ".
        "Se precisar de reagendar, responda a este email com pelo menos 24h de antecedencia.</p>".
        "<p>Obrigado,<br>Psiagora</p>"
    );

    // psicologo
    send_email(
        $cfg['email']['psicologo'],
        "Nova marcacao — $quando — {$booking['nome']}",
        "<p>Nova marcacao confirmada:</p>".
        "<ul>".
        "<li><strong>Quando:</strong> $quando</li>".
        "<li><strong>Cliente:</strong> {$booking['nome']}</li>".
        "<li><strong>Email:</strong> {$booking['email']}</li>".
        "<li><strong>Telefone:</strong> {$booking['telefone']}</li>".
        "</ul>".
        "<p><strong>Mensagem:</strong><br>" . nl2br(htmlspecialchars($booking['mensagem'])) . "</p>".
        "<p>Stripe session: <code>{$session->id}</code></p>"
    );

    http_response_code(200); echo 'ok'; exit;
}

if ($event->type === 'checkout.session.expired') {
    $session = $event->data->object;
    $holdId  = $session->metadata->hold_id ?? null;
    if ($holdId) {
        $holds = read_json($cfg['storage']['holds_file']);
        $holds['items'] = array_values(array_filter($holds['items'] ?? [], fn($h) => ($h['id'] ?? '') !== $holdId));
        write_json($cfg['storage']['holds_file'], $holds);
    }
    http_response_code(200); echo 'expired'; exit;
}

http_response_code(200); echo 'ignored';
