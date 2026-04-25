<?php
require __DIR__ . '/lib/helpers.php';
$cfg = load_config();

$sessionId = $_GET['session_id'] ?? '';
$booking = null;
if ($sessionId) {
    $bookings = read_json($cfg['storage']['bookings_file']);
    foreach (($bookings['items'] ?? []) as $b) {
        if (($b['stripe_session'] ?? '') === $sessionId) { $booking = $b; break; }
    }
}
?>
<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Consulta confirmada | Psiagora</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --verde: #3D8C6A; --verde-escuro: #2D6B50; --verde-claro: #EAF5EF;
      --cinza-fundo: #F7F8FA; --cinza-borda: #E5E7EB;
      --texto: #1A2332; --texto-sec: #5A6678; --branco: #FFFFFF;
      --gradiente: linear-gradient(135deg, #3D8C6A 0%, #4A90D9 100%);
    }
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:var(--cinza-fundo); color:var(--texto); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:var(--branco); border-radius:16px; border:1px solid var(--cinza-borda); padding:40px 32px; max-width:520px; width:100%; text-align:center; }
    .icon { width:72px; height:72px; border-radius:50%; background:var(--verde-claro); display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
    .icon svg { width:36px; height:36px; }
    h1 { font-size:1.5rem; font-weight:800; margin-bottom:8px; }
    .sub { color:var(--texto-sec); margin-bottom:24px; line-height:1.5; }
    .box { background:var(--verde-claro); border:1px solid rgba(61,140,106,.2); border-radius:12px; padding:16px; margin-bottom:20px; text-align:left; }
    .row { display:flex; justify-content:space-between; padding:4px 0; font-size:.9rem; }
    .row span:last-child { font-weight:600; }
    .btn { display:inline-block; padding:12px 24px; background:var(--verde); color:var(--branco); border-radius:8px; text-decoration:none; font-weight:700; font-size:.9rem; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="#3D8C6A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <h1>Consulta confirmada</h1>
    <p class="sub">Obrigado! Recebeu um email com todos os detalhes.</p>

    <?php if ($booking): ?>
      <div class="box">
        <div class="row"><span>Data</span><span><?= htmlspecialchars(fmt_pt($booking['date'], $booking['time'])) ?></span></div>
        <div class="row"><span>Duracao</span><span><?= (int)$cfg['sessao']['duracao_min'] ?> minutos</span></div>
        <div class="row"><span>Valor</span><span><?= number_format($booking['amount_cents']/100, 2, ',', '.') ?> EUR</span></div>
        <div class="row"><span>Referencia</span><span><?= htmlspecialchars($booking['id']) ?></span></div>
      </div>
    <?php else: ?>
      <div class="box">
        <p style="font-size:.85rem;color:var(--texto-sec)">A sua marcacao sera confirmada em instantes. Verifique a sua caixa de email dentro de 1-2 minutos.</p>
      </div>
    <?php endif; ?>

    <a href="/" class="btn">Voltar ao inicio</a>
  </div>
</body>
</html>
