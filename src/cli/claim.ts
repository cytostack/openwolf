import * as path from "node:path";
import { Command } from "commander";
import { Hippocampus } from "../hippocampus/index.js";
import type {
  ClaimObservation,
  ClaimProvenanceSource,
  ClaimRelation,
  ClaimRecallResponse,
  EvidenceQuality,
} from "../hippocampus/types.js";

const SENSITIVE_EXTENSIONS = new Set([
  ".pem", ".key", ".p8", ".p12", ".pfx", ".keystore", ".jks", ".ppk", ".kdbx", ".tfstate",
]);
const SENSITIVE_BASENAMES = new Set([".npmrc", ".netrc", ".htpasswd", ".pgpass"]);

function isSensitiveScopePath(value: string): boolean {
  const lower = path.basename(value.replace(/\\/g, "/")).toLowerCase();
  if (lower === ".env" || lower.startsWith(".env.")) return true;
  if (SENSITIVE_BASENAMES.has(lower)) return true;
  const extension = path.extname(lower);
  if (SENSITIVE_EXTENSIONS.has(extension)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(lower)) return true;
  return lower.includes("credential") || /^secrets\.(json|ya?ml|toml)$/.test(lower);
}

const EVIDENCE_QUALITIES = new Set<EvidenceQuality>([
  "automated-test",
  "reproducible-observation",
  "direct-tool-result",
  "explicit-user-correction",
  "verified-code-inspection",
  "agent-inference",
  "unverified-assumption",
]);
const CLAIM_RELATIONS = new Set<ClaimRelation>([
  "confirms",
  "contradicts",
  "refines",
]);
const PROVENANCE_SOURCES = new Set<ClaimProvenanceSource>([
  "user",
  "hook",
  "daemon",
  "manual",
  "agent",
]);

function commaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function validateScopePaths(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  for (const value of values) {
    if (isSensitiveScopePath(value)) {
      throw new Error(`Sensitive paths cannot be used as claim scope: ${value}`);
    }
  }
  return values;
}

function fail(message: string): void {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

export function recordClaimCommand(
  statement: string,
  options: {
    event: string;
    relation?: string;
    target?: string;
    quality?: string;
    verification?: string;
    source?: string;
    authority?: number;
    label?: string;
    paths?: string;
    platforms?: string;
    versions?: string;
    contexts?: string;
    note?: string;
    json?: boolean;
  }
): void {
  const relation = (options.relation ?? "confirms") as ClaimRelation;
  const quality = (options.quality ?? "unverified-assumption") as EvidenceQuality;
  const verification = (options.verification ?? quality) as EvidenceQuality;
  const source = (options.source ?? "manual") as ClaimProvenanceSource;
  if (!CLAIM_RELATIONS.has(relation)) return fail(`Unknown relation: ${relation}`);
  if (!EVIDENCE_QUALITIES.has(quality)) return fail(`Unknown evidence quality: ${quality}`);
  if (!EVIDENCE_QUALITIES.has(verification)) return fail(`Unknown verification method: ${verification}`);
  if (!PROVENANCE_SOURCES.has(source)) return fail(`Unknown provenance source: ${source}`);

  let observation: ClaimObservation;
  try {
    observation = {
      statement,
      event_id: options.event,
      relation,
      target_claim_id: options.target,
      quality,
      verification_method: verification,
      provenance: {
        source,
        authority: options.authority ?? 1,
        label: options.label,
      },
      scope: {
        paths: validateScopePaths(commaList(options.paths)),
        platforms: commaList(options.platforms),
        versions: commaList(options.versions),
        contexts: commaList(options.contexts),
      },
      note: options.note,
    };
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    const report = new Hippocampus(process.cwd()).recordClaimObservation(observation);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`${report.kind}: ${report.claim.id} [${report.claim.status}]`);
    console.log(`  ${report.claim.statement}`);
    console.log(`  confidence ${(report.claim.confidence * 100).toFixed(0)}%`);
    console.log(`  evidence ${report.claim.evidence_event_ids.join(", ")}`);
    if (report.claim.superseded_by) {
      console.log(`  superseded by ${report.claim.superseded_by}`);
    }
  } catch (error) {
    fail(`claim update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function printClaims(response: ClaimRecallResponse): void {
  if (response.claims.length === 0) {
    console.log("No claims found.");
    return;
  }
  console.log(`Found ${response.total_matches} matching claim(s)`);
  console.log();
  response.claims.forEach((claim, index) => {
    const detail = response.match_details[index];
    console.log(`${index + 1}. [${claim.status}] ${claim.statement}`);
    console.log(
      `   confidence ${(claim.confidence * 100).toFixed(0)}%, evidence strength ${detail.evidence_strength.toFixed(2)}`
    );
    console.log(`   evidence: ${claim.evidence_event_ids.join(", ") || "none"}`);
    if (claim.contradicting_event_ids.length > 0) {
      console.log(`   contradictions: ${claim.contradicting_event_ids.join(", ")}`);
    }
    if (claim.superseded_by) console.log(`   superseded by: ${claim.superseded_by}`);
    if (detail.match_reasons.length > 0) {
      console.log(`   match: ${detail.match_reasons.join(", ")}`);
    }
    console.log();
  });
}

export function recallClaimsCommand(
  query: string | undefined,
  options: {
    paths?: string;
    platforms?: string;
    versions?: string;
    disputed?: boolean;
    superseded?: boolean;
    limit?: number;
    json?: boolean;
  }
): void {
  try {
    const response = new Hippocampus(process.cwd()).recallClaims({
      query,
      paths: validateScopePaths(commaList(options.paths)),
      platforms: commaList(options.platforms),
      versions: commaList(options.versions),
      include_disputed: options.disputed,
      include_superseded: options.superseded,
      limit: options.limit ?? 5,
    });
    if (options.json) console.log(JSON.stringify(response, null, 2));
    else printClaims(response);
  } catch (error) {
    fail(`claim recall failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function createClaimCommand(): Command {
  const claim = new Command("claim").description(
    "Record and recall provenance-aware current knowledge claims"
  );

  claim
    .command("record")
    .description("Attach an explicit claim observation to an existing event")
    .argument("<statement>", "Claim statement")
    .requiredOption("--event <id>", "Evidence event ID")
    .option("--relation <relation>", "confirms, contradicts, or refines", "confirms")
    .option("--target <id>", "Target claim ID; required for contradicts/refines")
    .option("--quality <quality>", "Evidence quality", "unverified-assumption")
    .option("--verification <method>", "Verification method; defaults to quality")
    .option("--source <source>", "user, hook, daemon, manual, or agent", "manual")
    .option("--authority <n>", "Source authority from 0 to 1", Number, 1)
    .option("--label <label>", "Provenance label")
    .option("--paths <paths>", "Comma-separated project-relative paths")
    .option("--platforms <platforms>", "Comma-separated platforms")
    .option("--versions <versions>", "Comma-separated versions")
    .option("--contexts <contexts>", "Comma-separated context labels")
    .option("--note <note>", "Evidence note")
    .option("--json", "Output JSON", false)
    .action(recordClaimCommand);

  claim
    .command("recall")
    .description("Recall current claims; active claims are returned by default")
    .argument("[query]", "Statement words to match")
    .option("--paths <paths>", "Comma-separated project-relative paths")
    .option("--platforms <platforms>", "Comma-separated platforms")
    .option("--versions <versions>", "Comma-separated versions")
    .option("--disputed", "Include disputed claims", false)
    .option("--superseded", "Include superseded historical claims", false)
    .option("--limit <n>", "Maximum claims", (value) => parseInt(value, 10), 5)
    .option("--json", "Output JSON", false)
    .action(recallClaimsCommand);

  return claim;
}
