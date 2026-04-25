<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pagamento cancelado | Psiagora</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --verde: #3D8C6A; --cinza-fundo: #F7F8FA; --cinza-borda: #E5E7EB;
      --texto: #1A2332; --texto-sec: #5A6678; --branco: #FFFFFF;
    }
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:var(--cinza-fundo); color:var(--texto); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:var(--branco); border-radius:16px; border:1px solid var(--cinza-borda); padding:40px 32px; max-width:460px; width:100%; text-align:center; }
    .icon { width:64px; height:64px; border-radius:50%; background:#FEF3C7; display:flex; align-items:center; justify-content:center; margin:0 auto 18px; font-size:1.6rem; }
    h1 { font-size:1.35rem; font-weight:800; margin-bottom:8px; }
    p { color:var(--texto-sec); line-height:1.55; margin-bottom:22px; font-size:.92rem; }
    .btn-row { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
    .btn { padding:11px 20px; border-radius:8px; font-weight:700; text-decoration:none; font-size:.88rem; }
    .btn-primary { background:var(--verde); color:var(--branco); }
    .btn-ghost { border:1px solid var(--cinza-borda); color:var(--texto-sec); background:var(--branco); }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">!</div>
    <h1>Pagamento nao concluido</h1>
    <p>A sua reserva nao foi confirmada porque o pagamento foi cancelado ou expirou. O horario que escolheu volta a ficar disponivel para outros pacientes.</p>
    <div class="btn-row">
      <a href="/agendar.html" class="btn btn-primary">Tentar novamente</a>
      <a href="/" class="btn btn-ghost">Voltar ao inicio</a>
    </div>
  </div>
</body>
</html>
