# Payment Service — PoE for Checkout: Payment Authorization

This diagram shows the inter-service flow for the authorization sub-workflow and where Proofs of Execution (PoE) are emitted. The `payment` service emits PoEs at the ingress (request received), PSP egress/ingress (simulated PSP call), and decision (response) points.

```mermaid
sequenceDiagram
    autonumber
    participant FE as Frontend
    participant O as Orders
    participant P as Payment
    participant PSP as PSP (External)

    FE->>O: POST /orders (create)
    Note right of O: «PoE» ingress (order create)
    O-->>FE: 201 {orderId}

    FE->>P: POST /paymentAuth {orderId, amount}
    Note right of P: «PoE» ingress (authorize request)
    P->>PSP: POST /v1/authorize {amount, token}
    Note over P,PSP: «PoE» egress (PSP request)
    PSP-->>P: 200 {pspRef, authorised}
    Note right of P: «PoE» decision (PSP response)

    alt authorised == true
        P-->>FE: 200 {authorised:true, pspRef}
        Note right of P: «PoE» egress (decision: authorised)
        P-->>O: POST /orders/{id}/authorise {pspRef}
        Note right of O: «PoE» update (order state=Authorised)
    else authorised == false
        P-->>FE: 402 {authorised:false}
        Note right of P: «PoE» egress (decision: declined)
        P-->>O: POST /orders/{id}/decline {code}
        Note right of O: «PoE» update (order state=Declined)
    end
```

- PoE emission in code
  - Ingress (request): `src/payment/endpoints.go` emits PoE before calling `Service.Authorise`.
  - PSP egress/ingress: `src/payment/endpoints.go` emits PoE around the simulated PSP call (`psp_request` and `psp_response` stages).
  - Decision (response): `src/payment/endpoints.go` emits PoE after the authorization decision.
  - Sidecar ingest URL: `SIDECAR_INGEST_URL` (default `http://127.0.0.1:8089/prove`).
