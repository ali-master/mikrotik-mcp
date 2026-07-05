---
name: manage-certificates
title: Manage TLS certificates and Let's Encrypt
description: Audit certificate expiry, issue or renew Let's Encrypt certificates via ACME, and deploy them to services.
arguments:
  - name: domain
    description: Domain name for Let's Encrypt issuance (e.g. "router.example.com"). Required for issuing new certificates.
    required: false
  - name: action
    description: What to do — "audit" (check expiry), "issue" (new Let's Encrypt cert), or "renew" (renew expiring certs). Default is "audit".
    required: false
---

Manage TLS certificates on this MikroTik device — audit expiry dates, issue new
certificates via Let's Encrypt (ACME), and deploy them to services.

Domain: {{domain}}
Action: {{action}}

Follow the workflow for the requested action:

**If auditing (or no action specified):**

1. Call `audit_certificate_expiry` to scan all installed certificates. It reports
   each certificate's subject, issuer, expiry date, and days remaining.
2. Flag any certificates expiring within 30 days as **urgent**, within 90 days as
   **warning**.
3. For expiring certificates, recommend renewal — either via ACME for Let's
   Encrypt certs, or manual replacement for CA-signed certs.
4. Call `list_certificates` for a full inventory including self-signed and CA certs.

**If issuing a new certificate:**

1. Confirm {{domain}} resolves to this router's public IP (for HTTP-01 challenge).
2. Ensure port 80 is accessible from the internet (check `list_nat_rules` and
   `list_filter_rules` for port 80).
3. Call `request_letsencrypt_certificate` with the domain name.
4. Verify issuance with `list_certificates` — the new cert should appear with
   the Let's Encrypt issuer.
5. Deploy the cert to the relevant service (e.g. `set_ip_service` for www-ssl,
   or configure it for SSTP/OpenVPN).

**If renewing:**

1. Call `audit_certificate_expiry` to identify which certs need renewal.
2. For each expiring Let's Encrypt cert, call `request_letsencrypt_certificate`
   with the same domain to renew.
3. Verify renewal with `list_certificates`.
4. Recommend setting up a scheduler script for automatic renewal (e.g. monthly).

Report all certificate changes and service assignments.
