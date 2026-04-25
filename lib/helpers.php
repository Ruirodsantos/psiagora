<?php
/**
 * Helpers partilhados: storage de bookings/holds, Google Calendar, email.
 */

function load_config(): array {
    static $cfg = null;
    if ($cfg === null) $cfg = require __DIR__ . '/../config.php';
    return $cfg;
}

function json_out(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Garante que o ficheiro existe com conteudo por defeito. */
function ensure_file(string $path, string $default = '{}'): void {
    if (!is_dir(dirname($path))) @mkdir(dirname($path), 0750, true);
    if (!file_exists($path)) file_put_contents($path, $default);
}

/** Le um ficheiro JSON com lock partilhado. */
function read_json(string $path): array {
    ensure_file($path, '{}');
    $fp = fopen($path, 'r');
    if (!$fp) return [];
    flock($fp, LOCK_SH);
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN); fclose($fp);
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

/** Escreve JSON com lock exclusivo. */
function write_json(string $path, array $data): void {
    ensure_file($path, '{}');
    $fp = fopen($path, 'c+');
    if (!$fp) throw new RuntimeException('Nao foi possivel abrir ' . $path);
    flock($fp, LOCK_EX);
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    fflush($fp); flock($fp, LOCK_UN); fclose($fp);
}

/** Lista de slots ocupados (bookings confirmados + holds validos) por dia. */
function slots_ocupados(): array {
    $cfg = load_config();
    $bookings = read_json($cfg['storage']['bookings_file']);
    $holds    = read_json($cfg['storage']['holds_file']);

    $ocup = [];
    foreach (($bookings['items'] ?? []) as $b) {
        if (($b['status'] ?? '') === 'cancelled') continue;
        $ocup[$b['date']][] = $b['time'];
    }
    $agora = time();
    $ttl   = ($cfg['storage']['hold_ttl_min'] ?? 10) * 60;
    foreach (($holds['items'] ?? []) as $h) {
        if (($h['created_ts'] ?? 0) + $ttl < $agora) continue;
        $ocup[$h['date']][] = $h['time'];
    }
    return $ocup;
}

/**
 * Liga ao Google Calendar e devolve periodos ocupados.
 * Se a library nao estiver instalada ou as credenciais faltarem, devolve [].
 * @return array<string,string[]>  map dia => lista de horas "HH:MM" ocupadas
 */
function google_busy(int $year, int $month): array {
    $cfg = load_config();
    $gc  = $cfg['google_calendar'];
    $json = $gc['service_account_json'] ?? '';

    if (!$json || !file_exists($json))              return [];
    if (!file_exists(__DIR__ . '/../vendor/autoload.php')) return [];
    require_once __DIR__ . '/../vendor/autoload.php';
    if (!class_exists('Google\\Client'))            return [];

    try {
        $tz = new DateTimeZone($cfg['sessao']['timezone']);
        $start = (new DateTime(sprintf('%04d-%02d-01 00:00:00', $year, $month), $tz));
        $end   = (clone $start)->modify('first day of next month');

        $client = new Google\Client();
        $client->setAuthConfig($json);
        $client->addScope('https://www.googleapis.com/auth/calendar.readonly');
        $service = new Google\Service\Calendar($client);

        $fbReq = new Google\Service\Calendar\FreeBusyRequest();
        $item  = new Google\Service\Calendar\FreeBusyRequestItem();
        $item->setId($gc['calendar_id']);
        $fbReq->setItems([$item]);
        $fbReq->setTimeMin($start->format(DateTime::RFC3339));
        $fbReq->setTimeMax($end->format(DateTime::RFC3339));
        $fbReq->setTimeZone($cfg['sessao']['timezone']);

        $resp = $service->freebusy->query($fbReq);
        $busy = $resp->getCalendars()[$gc['calendar_id']]->getBusy() ?? [];

        $dur = $cfg['sessao']['duracao_min'] + $cfg['sessao']['buffer_min'];
        $out = [];
        foreach ($busy as $period) {
            $s = new DateTime($period->getStart(), $tz);
            $e = new DateTime($period->getEnd(),   $tz);
            $cur = clone $s;
            while ($cur < $e) {
                $dia = $cur->format('Y-m-d');
                $hora = $cur->format('H:i');
                $out[$dia][] = $hora;
                $cur->modify("+{$dur} minutes");
            }
            // tambem marcar a hora de inicio do periodo
            $out[$s->format('Y-m-d')][] = $s->format('H:i');
        }
        return $out;
    } catch (Throwable $e) {
        error_log('google_busy error: ' . $e->getMessage());
        return [];
    }
}

/** Cria um evento no Google Calendar quando uma marcacao e confirmada. */
function google_create_event(array $booking): ?string {
    $cfg = load_config();
    $gc  = $cfg['google_calendar'];
    if (empty($gc['sync_write']))                   return null;
    if (!file_exists($gc['service_account_json'] ?? '')) return null;
    if (!file_exists(__DIR__ . '/../vendor/autoload.php')) return null;
    require_once __DIR__ . '/../vendor/autoload.php';
    if (!class_exists('Google\\Client'))            return null;

    try {
        $tz = new DateTimeZone($cfg['sessao']['timezone']);
        $start = new DateTime($booking['date'] . ' ' . $booking['time'], $tz);
        $end   = (clone $start)->modify('+' . $cfg['sessao']['duracao_min'] . ' minutes');

        $client = new Google\Client();
        $client->setAuthConfig($gc['service_account_json']);
        $client->addScope('https://www.googleapis.com/auth/calendar');
        $service = new Google\Service\Calendar($client);

        $event = new Google\Service\Calendar\Event([
            'summary' => 'Consulta: ' . ($booking['nome'] ?? 'Cliente'),
            'description' =>
                "Cliente: {$booking['nome']}\n".
                "Email: {$booking['email']}\n".
                "Telefone: {$booking['telefone']}\n\n".
                ($booking['mensagem'] ?? ''),
            'start' => ['dateTime' => $start->format(DateTime::RFC3339), 'timeZone' => $cfg['sessao']['timezone']],
            'end'   => ['dateTime' => $end->format(DateTime::RFC3339),   'timeZone' => $cfg['sessao']['timezone']],
            'attendees' => [['email' => $booking['email']]],
        ]);
        $created = $service->events->insert($gc['calendar_id'], $event, ['sendUpdates' => 'all']);
        return $created->getId();
    } catch (Throwable $e) {
        error_log('google_create_event error: ' . $e->getMessage());
        return null;
    }
}

/** Envia email via SMTP (PHPMailer). Silenciosamente falha se a lib nao estiver instalada. */
function send_email(string $to, string $subject, string $htmlBody): bool {
    $cfg = load_config()['email'];
    if (!file_exists(__DIR__ . '/../vendor/autoload.php')) {
        error_log('send_email: vendor/ nao instalado, email nao enviado para ' . $to);
        return false;
    }
    require_once __DIR__ . '/../vendor/autoload.php';
    if (!class_exists('PHPMailer\\PHPMailer\\PHPMailer')) return false;

    try {
        $m = new PHPMailer\PHPMailer\PHPMailer(true);
        $m->isSMTP();
        $m->Host       = $cfg['smtp_host'];
        $m->Port       = (int)$cfg['smtp_port'];
        $m->SMTPAuth   = true;
        $m->Username   = $cfg['smtp_user'];
        $m->Password   = $cfg['smtp_pass'];
        $m->SMTPSecure = $cfg['smtp_secure'];
        $m->CharSet    = 'UTF-8';
        $m->setFrom($cfg['from_email'], $cfg['from_name']);
        $m->addReplyTo($cfg['reply_to']);
        $m->addAddress($to);
        $m->isHTML(true);
        $m->Subject = $subject;
        $m->Body    = $htmlBody;
        $m->AltBody = strip_tags($htmlBody);
        return $m->send();
    } catch (Throwable $e) {
        error_log('send_email error: ' . $e->getMessage());
        return false;
    }
}

/** Limpa holds expirados do ficheiro de holds. */
function purge_holds(): void {
    $cfg = load_config();
    $holds = read_json($cfg['storage']['holds_file']);
    $ttl = ($cfg['storage']['hold_ttl_min'] ?? 10) * 60;
    $agora = time();
    $items = array_values(array_filter(($holds['items'] ?? []), fn($h) =>
        ($h['created_ts'] ?? 0) + $ttl >= $agora
    ));
    write_json($cfg['storage']['holds_file'], ['items' => $items]);
}

/** Formata uma data+hora para apresentar ao cliente. */
function fmt_pt(string $date, string $time): string {
    $meses = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    [$y,$m,$d] = explode('-', $date);
    return sprintf('%s de %s de %s, as %s', (int)$d, $meses[(int)$m - 1], $y, $time);
}
