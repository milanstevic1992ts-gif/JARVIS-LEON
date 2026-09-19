# Installazione GE360 JARVIS su Debian/Linux

Installazione consigliata per il server GE360 low-resource.

## Installazione nuova

```bash
sudo apt update
sudo apt install -y git

cd ~
git clone https://github.com/milanstevic1992ts-gif/JARVIS-LEON.git
cd JARVIS-LEON

bash install.sh
```

L'installer:

1. installa i pacchetti Linux necessari;
2. installa Node.js 24 LTS se serve;
3. installa pnpm 12.4.1;
4. installa/avvia Ollama se serve;
5. inizializza il profilo JARVIS senza setup interattivo;
6. applica il profilo low-resource GE360;
7. configura Ollama a 8K / 1 richiesta / 1 modello / q8_0;
8. scarica `qwen3.5:4b`;
9. compila app + server;
10. installa e avvia `ge360-jarvis.service`;
11. esegue doctor e benchmark.

## Con Restart Ollama dal Brain Dashboard

```bash
bash install.sh --enable-ollama-restart
```

Questa opzione non concede sudo generale a JARVIS: abilita soltanto il comando necessario a riavviare `ollama.service`.

## Installazione senza benchmark finale

```bash
bash install.sh --no-benchmark
```

## Aggiornamento di un'installazione esistente

```bash
cd ~/JARVIS-LEON
git pull
bash install.sh
```

## Controlli dopo l'installazione

```bash
systemctl status ge360-jarvis --no-pager
journalctl -u ge360-jarvis -f
pnpm run jarvis:doctor
ollama ps
```

Interfaccia locale:

```text
http://127.0.0.1:5366
```

Se accedi da un altro dispositivo, usa il metodo di rete privata già previsto per il server (per esempio Tailscale) invece di esporre direttamente JARVIS su Internet.
