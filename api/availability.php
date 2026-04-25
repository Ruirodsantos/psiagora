<?php
/**
 * GET /api/availability.php?year=2026&month=4
 * Devolve: { days: { "2026-04-20": ["09:00","10:00", ...], ... } }
 */
require __DIR__ . '/../lib/helpers.php';

header('Cache-Control: no-store');

$cfg = load_config();
$year  = (int)($_GET['year']  ?? date('Y'));
$month = (int)($_GET['month'] ?? date('n'));
if ($month < 1 || $month > 12) json_out(['error' => 'Mes invalido'], 400);

purge_holds();

$tz = new DateTimeZone($cfg['sessao']['timezone']);
$today = new DateTime('now', $tz);
$cutoff = (clone $today)->modify('+' . $cfg['sessao']['antecedencia_min_h'] . ' hours');

$first = new DateTime(sprintf('%04d-%02d-01 00:00:00', $year, $month), $tz);
$last  = (clone $first)->modify('last day of this month');

$ocup  = slots_ocupados();
$busy  = google_busy($year, $month);
$feriados = array_flip($cfg['feriados'] ?? []);

$days = [];
$d = clone $first;
while ($d <= $last) {
    $iso = $d->format('Y-m-d');
    $dow = (int)$d->format('N'); // 1=Mon..7=Sun

    // Feriados ou dia fora da janela visivel
    if (isset($feriados[$iso])) { $days[$iso] = []; $d->modify('+1 day'); continue; }

    $horarios = $cfg['horario'][$dow] ?? [];
    if (!$horarios) { $days[$iso] = []; $d->modify('+1 day'); continue; }

    $livres = [];
    foreach ($horarios as $hora) {
        $dt = DateTime::createFromFormat('Y-m-d H:i', "$iso $hora", $tz);
        if ($dt < $cutoff) continue;                          // demasiado em cima da hora
        if (in_array($hora, $ocup[$iso] ?? [], true)) continue; // ja marcado / hold
        if (in_array($hora, $busy[$iso] ?? [], true)) continue; // ocupado no Google Calendar
        $livres[] = $hora;
    }
    $days[$iso] = $livres;
    $d->modify('+1 day');
}

json_out(['days' => $days]);
