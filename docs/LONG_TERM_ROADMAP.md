# Long-Term Roadmap (post-hackathon)

Nothing here is in scope before November 4, 2026, and none of it is implemented. It is listed so the MVP architecture does not block it.

## Scale
- **Millions of documents:** PostgreSQL (JSONB for extractions), S3-compatible object storage for originals, a dedicated search index (OpenSearch/Tantivy) plus vector retrieval where it measurably helps.
- **Distributed workers:** move the job runner onto a durable queue (Redis Streams, NATS or Postgres-based) with stateless worker processes; job/item schema already supports this.
- **Multiple GPU servers:** provider routing by model and load; vLLM serving for open-weight Meta models (e.g. Muse Glimmer); batching.
- **Large-scale database infrastructure:** partitioning by collection, archival tiers, backup/restore runbooks.

## Intelligence
- Advanced OCR and diagram understanding (vision models on scanned pages, title blocks, stamps, symbols).
- Audio and video analysis (meeting recordings, inspection footage) with Meta speech/vision models.
- Domain-specific models and evaluation suites per industry.
- Organizational workflow learning: richer teach-by-example beyond rules (retrieval of approved examples, optional fine-tuning with explicit consent and evaluation).
- More cross-document reasoning: material, quantity, revision, date-sequence and supplier-obligation conflicts; natural-language investigation with citations.
- Advanced local-model optimization: quantization choices, speculative decoding, caching.

## Enterprise
- Enterprise identity (OIDC/SAML SSO, SCIM), token expiry and rotation, session cookies.
- Fine-grained access control: per-collection and per-document ACLs, classification labels, need-to-know enforcement in search.
- Secure integrations (SharePoint, network drives, PLM/ERP) with least-privilege connectors.
- Sandboxed parsing (separate process/container with seccomp and resource limits).
- Rate limiting, tamper-evident audit (hash chaining), SIEM export.

## Assurance and business
- Independent security audits and penetration tests.
- Formal compliance pathways (e.g. SOC 2, ISO 27001; government frameworks only through proper accreditation).
- Commercial deployment packaging, licensing, enterprise support and SLAs.
