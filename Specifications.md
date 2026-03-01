🛡️ APORIA: Das Dezentrale Resurrection-Protokoll

Version: 1.0 (Stateless MVP)

Status: Spezifikation Abgeschlossen / Ready for Implementation
I. Strategische Philosophie & Compliance

Aporia folgt dem „Hammer-Modell“: Wir bauen ein neutrales Werkzeug. Der Code ist ein Naturgesetz aus Mathematik und Logik.

    No-KYC: Der Smart Contract ist „permissionless“. Da der Service rein programmatisch via Blockchain abgewickelt wird, gibt es keine menschliche Instanz, die Ausweise prüft. Der Code unterscheidet nicht zwischen Nutzergruppen.

    Neutralität: Das Protokoll prüft nur: „Wurde gezahlt?“ und „Ist der Bot offline?“. Es wertet nicht den Inhalt oder Zweck des Bots (Zensurresistenz).

    Dezentralität als Schutz: Durch das Deployment auf der Base L2 und die Nutzung dezentraler Cloud-Anbieter (Akash) entzieht sich das System der physischen Abschaltung durch einzelne Web2-Provider.

II. Das Produktmodell: "Stateless Recovery"

Um die Komplexität (Datenmigration/Haftung) im MVP zu eliminieren, konzentriert sich Aporia auf den modernen Industriestandard:

    Trennung von Compute & State: Der Bot ist „Stateless“. Sein Gedächtnis (Datenbank) liegt bei externen Providern (Supabase, MongoDB, AWS RDS).

    Der Service: Aporia garantiert nicht die Datenintegrität, sondern die Prozess-Verfügbarkeit. Wenn der Server stirbt, liefert Aporia einen neuen „Körper“ (Compute-Power), der sich mit dem bestehenden Gedächtnis verbindet.

    Das Zeitfenster: Aporia ist die „Erste Hilfe“. Wir stellen Notfall-Rechenpower für 24–72 Stunden bereit, damit der Entwickler den Bot in Ruhe auf seine Haupt-Infrastruktur zurückziehen kann.

III. Technische Architektur (Die 4 Module)
1. Registry (Smart Contract - Base L2)

    Data Structure: Speichert imageURI (Docker), envHash (verschlüsselte Keys), Tier (Hardware-Klasse) und Balance.

    Escrow-Logik: Nutzer hinterlegen Guthaben (USDC/ETH). Monitoring startet nur, wenn Guthaben > 2x Restart-Kosten.

    Cooldown-Sperre: Nach einem Restart ist der Bot für 6 Stunden gesperrt (Schutz vor teuren Endlosschleifen).

2. Heartbeat (Watchdog - Node.js/Go)

    Standardized Health-Check: Verpflichtender Endpoint GET /aporia-health.

    Failure-Logik: 3 Timeouts à 30 Sek. (insgesamt 90 Sek. Downtime) = Trigger.

    Async-Batching: Parallelisiertes Pingen tausender Bots ohne Performance-Verlust.

3. Secret Management (Security)

    Asymmetrische Verschlüsselung: User verschlüsselt API-Keys lokal. Nur das Deployment-Modul kann sie im Moment des Absturzes kurzzeitig im RAM entschlüsseln. Keine Keys im Klartext auf der Chain.

4. Deployment (Akash/Docker)

    Automatisierung: Generiert SDL-Files (Stack Definition Language) für dezentrale Cloud-Marktplätze.

    Hardware-Tiers (Blueprints):

        NANO: 1 vCPU / 1 GB RAM (Trading-Bots)

        LOGIC: 2 vCPU / 4 GB RAM (API-Agents)

        EXPERT: 4 vCPU / 8 GB RAM (Data-Automation)

IV. Ökonomisches Modell (Bootstrap-Modell)

Kein Startkapital nötig, da das System Cashflow-positiv arbeitet:

    Negative Working Capital: User zahlen die Versicherung im Voraus.

    Risiko-Kalkulation: Einnahmen (Prämien) stehen den seltenen Ausgaben (Notfall-Server-Miete) gegenüber.

    Marge: Durch die Nutzung dezentraler Cloud-Power (70-80% günstiger als AWS) bleibt ein Großteil der Prämie im Sicherheits-Pool.

    Unique Selling Point (USP): Günstiger und sicherer als DIY-Lösungen, da Aporia „externe“ Redundanz und sofortige Liquidität bei Cloud-Anbietern bietet.

V. Operative Constraints (Die Leitplanken)

    Min-Balance: Bot muss Kosten für 2 Restarts decken.

    Image Size: Maximal 2 GB (schnelle Migration).

    Port Restriction: Nur 80, 443, 3000.

    Admin Kill-Switch: Möglichkeit, bösartige Images (Malware/DDoS) global zu sperren.

VI. Roadmap (Der Schlachtplan)

    Alpha: Manueller Test-Run mit eigenen Bots (Stateless Docker + Akash).

    Beta: Launch des Base Smart Contracts + Monitoring für Early Adopters.

    V1.0: Automatisierte Skalierung und Integration von Reputation-Attestations (Proof of Honesty).