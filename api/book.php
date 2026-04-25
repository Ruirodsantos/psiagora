<?php
/**
 * POST /api/book.php
 * Body JSON: { date, time, nome, email, telefone, mensagem }
 * 1) valida slot ainda livre
 * 2) cria HOLD (TTL 10min)
 * 3) cria Stripe Checkout Session com metadata
 * 4) devolve { checkout_url }
 *
 * Se o pagamento nao concluir em 10min o hold expira automaticamente.
 */
require __DIR__ . '/../lib/helpers.php';

$cfg = load_config();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['error' => 'Metodo invalido'], 405);

$raw = file_get_contents('php://input');
$in  = json_decode($raw, true);
if (!is_array($in)) json_out(['error' => 'JSON invalido'], 400);

// ── Validacao basica ──────────────────────────────────────────
$date = $in['date'] ?? '';
$time = $in['time'] ?? '';
$nome = trim($in['nome'] ?? '');
$email= trim($in['email'] ?? '');
$tel  = trim($in['telefone'] ?? '');
$msg  = trim($in['mensagem'] ?? '');

if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date))  json_out(['error' => 'Data invalida'], 400);
if (!preg_match('/^\d{2}:\d{2}$/', $time))        json_out(['error' => 'Hora invalida'], 400);
if (strlen($nome) < 3)                            json_out(['error' => 'Nome muito curto'], 400);
if (!filter_var($email, FILTER_VALIDATE_EMAIL))   json_out(['error' => 'Email invalido'], 400);
if (strlen($msg) > 600)                           json_out(['error' => 'Mensagem demasiado longa'], 400);

// ── Verifica se o slot continua livre ─────────────────────────
purge_holds();
$tz = new DateTimeZone($cfg['sessao']['timezone']);
$slot_dt = DateTime::createFromFormat('Y-m-d H:i', "$date $time", $tz);
if (!$slot_dt)                                json_out(['error' => 'Data/hora invalida'], 400);
$cutoff = (new DateTime('now', $tz))->modify('+' . $cfg['sessao']['antecedencia_min_h'] . ' hours');
if ($slot_dt < $cutoff)                       json_out(['error' => 'Este horario ja nao pode ser marcado (falta menos de ' . $cfg['sessao']['antecedencia_min_h'] . 'h).'], 400);

$dow = (int)$slot_dt->format('N');
$horarios = $cfg['horario'][$dow] ?? [];
if (!in_array($time, $horarios, true))        json_out(['error' => 'Horario nao permitido nesse dia'], 400);
if (in_array($date, $cfg['feriados'] ?? [], true)) json_out(['error' => 'Dia indisponivel (feriado)'], 400);

$ocup = slots_ocupados();
if (in_array($time, $ocup[$date] ?? [], true)) json_out(['error' => 'Este horario acabou de ser reservado. Escolha outro.'], 409);

$busyGC = google_busy((int)$slot_dt->format('Y'), (int)$slot_dt->format('n'));
if (in_array($time, $busyGC[$date] ?? [], true)) json_out(['error' => 'Este horario ja nao esta disponivel.'], 409);

// ── Cria HOLD ─────────────────────────────────────────────────
$holdId = bin2hex(random_bytes(12));
$holds = read_json($cfg['storage']['holds_file']);
$holds['items'] = $holds['items'] ?? [];
$holds['items'][] = [
    'id'        => $holdId,
    'date'      => $date,
    'time'      => $time,
    'nome'      => $nome,
    'email'     => $email,
    'telefone'  => $tel,
    'mensagem'  => $msg,
    'created_ts'=> time(),
];
write_json($cfg['storage']['holds_file'], $holds);

// ── Stripe Checkout ───────────────────────────────────────────
if (!file_exists(__DIR__ . '/../vendor/autoload.php')) {
    json_out(['error' => 'Backend ainda nao instalou Composer (vendor/ em falta). Ver README.'], 500);
}
require __DIR__ . '/../vendor/autoload.php';

try {
    \Stripe\Stripe::setApiKey($cfg['stripe']['secret_key']);

    $session = \Stripe\Checkout\Session::create([
        'payment_method_types' => ['card', 'multibanco'], // MB Way em Portugal usa 'multibanco' ou 'card'
        'mode' => 'payment',
        'customer_email' => $email,
        'expires_at' => time() + ($cfg['storage']['hold_ttl_min'] * 60) + 60,
        'line_items' => [[
            'price_data' => [
                'currency' => $cfg['sessao']['moeda'],
                'product_data' => [
                    'name' => $cfg['sessao']['nome'],
                    'description' => 'Consulta em ' . fmt_pt($date, $time),
                ],
                'unit_amount' => (int)$cfg['sessao']['preco_cents'],
            ],
            'quantity' => 1,
        ]],
        'metadata' => [
            'hold_id'  => $holdId,
            'date'     => $date,
            'time'     => $time,
            'nome'     => $nome,
            'email'    => $email,
            'telefone' => $tel,
        ],
        'success_url' => $cfg['stripe']['success_url'],
        'cancel_url'  => $cfg['stripe']['cancel_url'],
    ]);

    json_out(['checkout_url' => $session->url, 'hold_id' => $holdId]);

} catch (\Stripe\Exception\ApiErrorException $e) {
    error_log('Stripe error: ' . $e->getMessage());
    json_out(['error' => 'Erro a contactar o Stripe. Tente novamente.'], 502);
} catch (Throwable $e) {
    error_log('book.php error: ' . $e->getMessage());
    json_out(['error' => 'Erro interno.'], 500);
}
