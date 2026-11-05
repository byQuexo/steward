---
title: VPN-Einrichtung (Scan)
owner: it
version: "2025.4"
scanned: true
---
# VPN-Einrichtung

Acme nutzt WireGuard für den Fernzugriff. Der Server ist vpn.acme.example auf Port 51820.

1. WireGuard aus dem Software-Center installieren.
2. Die Konfigurationsdatei im Self-Service-Portal unter Mein Zugang herunterladen.
3. Die Datei in WireGuard importieren und die Verbindung aktivieren.
<!-- page -->
## Fehlerbehebung

Meldung handshake did not complete: Die Systemzeit des Geräts weicht ab. Zeit synchronisieren und neu verbinden.

Kein Zugriff auf interne Seiten: Den DNS-Server 10.20.0.53 eintragen oder das Gerät neu starten.

Bleibt der Fehler bestehen, ein Ticket mit der Kategorie VPN öffnen.
