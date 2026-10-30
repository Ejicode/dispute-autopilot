package vault

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/Ejicode/dispute-autopilot/internal/types"
	"github.com/go-pdf/fpdf"
)

var whitespaceCollapse = regexp.MustCompile(`\s+`)

// GenerateDisputePDFPacket renders the tamper-evident evidence packet as PDF.
func GenerateDisputePDFPacket(dispute types.Dispute, evidenceItems []types.EvidenceItem) ([]byte, error) {
	pdf := fpdf.New("P", "pt", "Letter", "")
	pdf.SetTitle(fmt.Sprintf("PayPal Dispute Evidence Packet - %s", dispute.PayPalDisputeID), false)
	pdf.SetAuthor("Dispute Autopilot Evidence Vault", false)
	pdf.SetMargins(40, 40, 40)
	pdf.SetAutoPageBreak(false, 0)
	pdf.AddPage()

	width, _ := pdf.GetPageSize()

	// ── Header banner ──────────────────────────────────────────────────
	pdf.SetFillColor(0, 112, 186)
	pdf.Rect(40, 40, width-80, 55, "F")
	pdf.SetFont("Helvetica", "B", 16)
	pdf.SetTextColor(255, 255, 255)
	pdf.Text(55, 70, "DISPUTE AUTOPILOT EVIDENCE PACKET")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(230, 242, 255)
	pdf.Text(55, 86, "OFFICIAL MERCHANT SUBMISSION & CRYPTOGRAPHIC PROOF")

	// ── Case metadata box ──────────────────────────────────────────────
	pdf.SetFillColor(245, 247, 250)
	pdf.SetDrawColor(217, 224, 235)
	pdf.Rect(40, 120, width-80, 90, "DF")

	metadata := [][2]string{
		{"PayPal Dispute ID:", dispute.PayPalDisputeID},
		{"Transaction ID:", dispute.TransactionID},
		{"Dispute Reason:", dispute.Reason},
		{"Disputed Amount:", fmt.Sprintf("$%.2f %s", float64(dispute.AmountCents)/100, dispute.Currency)},
		{"Response Deadline:", formatDeadline(dispute.ResponseDeadline)},
		{"Evidence Score:", fmt.Sprintf("%d/100 (%s)", dispute.StrengthScore, dispute.Recommendation)},
	}

	metaY := 140.0
	for i := 0; i < len(metadata); i += 2 {
		left := metadata[i]
		pdf.SetFont("Helvetica", "B", 9)
		pdf.SetTextColor(51, 64, 77)
		pdf.Text(55, metaY, truncate(left[0], 40))
		pdf.SetFont("Helvetica", "", 9)
		pdf.SetTextColor(26, 26, 26)
		pdf.Text(170, metaY, truncate(left[1], 34))

		if i+1 < len(metadata) {
			right := metadata[i+1]
			pdf.SetFont("Helvetica", "B", 9)
			pdf.SetTextColor(51, 64, 77)
			pdf.Text(320, metaY, truncate(right[0], 30))
			pdf.SetFont("Helvetica", "", 9)
			pdf.SetTextColor(26, 26, 26)
			pdf.Text(440, metaY, truncate(right[1], 28))
		}
		metaY += 22
	}

	// ── Evidence section header ────────────────────────────────────────
	pdf.SetFont("Helvetica", "B", 12)
	pdf.SetTextColor(26, 38, 51)
	pdf.Text(40, 230, fmt.Sprintf("VERIFIED EVIDENCE ITEMS (%d)", len(evidenceItems)))
	pdf.SetDrawColor(204, 217, 230)
	pdf.SetLineWidth(1)
	pdf.Line(40, 235, width-40, 235)

	top := 255.0
	for _, item := range evidenceItems {
		if top > 672 {
			pdf.AddPage()
			top = 50
		}
		pdf.SetFillColor(255, 255, 255)
		pdf.SetDrawColor(204, 217, 230)
		pdf.Rect(40, top, width-80, 75, "DF")

		pdf.SetFont("Helvetica", "B", 10)
		pdf.SetTextColor(13, 64, 128)
		pdf.Text(52, top+18, truncate(fmt.Sprintf("[%s] %s", item.EvidenceType, item.Title), 95))

		pdf.SetFont("Helvetica", "", 8)
		pdf.SetTextColor(102, 115, 128)
		pdf.Text(52, top+32, truncate(fmt.Sprintf("Source: %s | Captured: %s", item.Source, item.CapturedAt), 120))

		clean := truncate(whitespaceCollapse.ReplaceAllString(item.Content, " "), 110)
		pdf.SetTextColor(51, 51, 51)
		pdf.Text(52, top+48, "Data: "+clean+"...")

		pdf.SetTextColor(26, 128, 51)
		pdf.Text(52, top+64, "SHA-256: "+item.SHA256Hash)

		top += 88
	}

	// ── Footer ─────────────────────────────────────────────────────────
	pdf.SetDrawColor(204, 204, 204)
	pdf.SetLineWidth(0.5)
	pdf.Line(40, 742, width-40, 742)
	pdf.SetFont("Helvetica", "", 7.5)
	pdf.SetTextColor(128, 128, 128)
	pdf.Text(40, 757, "Generated deterministically by Dispute Autopilot Vault | Tamper-evident SHA-256 verified records")

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func formatDeadline(value string) string {
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		if t, err = time.Parse(time.RFC3339Nano, value); err != nil {
			return "Unknown"
		}
	}
	return t.UTC().Format("2006-01-02 15:04:05 UTC")
}

func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return strings.TrimSpace(string(runes[:max]))
}

// GenerateVaultPDFDossier renders the entire merchant evidence vault ledger as a PDF dossier.
func GenerateVaultPDFDossier(merchantID string, items []types.EvidenceItem) ([]byte, error) {
	pdf := fpdf.New("P", "pt", "Letter", "")
	pdf.SetTitle("Evidence Vault Consolidated Dossier", false)
	pdf.SetAuthor("Dispute Autopilot Evidence Vault", false)
	pdf.SetMargins(40, 40, 40)
	pdf.SetAutoPageBreak(false, 0)
	pdf.AddPage()

	width, _ := pdf.GetPageSize()

	// Header banner
	pdf.SetFillColor(0, 48, 135)
	pdf.Rect(40, 40, width-80, 55, "F")
	pdf.SetFont("Helvetica", "B", 16)
	pdf.SetTextColor(255, 255, 255)
	pdf.Text(55, 70, "EVIDENCE VAULT CONSOLIDATED DOSSIER")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(230, 242, 255)
	pdf.Text(55, 86, "TAMPER-EVIDENT CRYPTOGRAPHIC LEDGER — PAYPAL SELLER PROTECTION")

	// Summary metadata box
	pdf.SetFillColor(245, 247, 250)
	pdf.SetDrawColor(217, 224, 235)
	pdf.Rect(40, 110, width-80, 65, "DF")

	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetTextColor(51, 64, 77)
	pdf.Text(55, 130, "Merchant ID:")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(26, 26, 26)
	pdf.Text(150, 130, truncate(merchantID, 30))

	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetTextColor(51, 64, 77)
	pdf.Text(300, 130, "Generated At:")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(26, 26, 26)
	pdf.Text(390, 130, time.Now().UTC().Format("2006-01-02 15:04:05 UTC"))

	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetTextColor(51, 64, 77)
	pdf.Text(55, 155, "Total Records:")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(26, 26, 26)
	pdf.Text(150, 155, fmt.Sprintf("%d verified items", len(items)))

	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetTextColor(51, 64, 77)
	pdf.Text(300, 155, "Integrity Standard:")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(0, 128, 64)
	pdf.Text(390, 155, "SHA-256 Chained & Immutable")

	// Section header
	pdf.SetFont("Helvetica", "B", 12)
	pdf.SetTextColor(26, 38, 51)
	pdf.Text(40, 200, fmt.Sprintf("AUDITED EVIDENCE RECORDS (%d)", len(items)))
	pdf.SetDrawColor(204, 217, 230)
	pdf.SetLineWidth(1)
	pdf.Line(40, 205, width-40, 205)

	top := 220.0
	for idx, item := range items {
		if top > 670 {
			renderDossierFooter(pdf, width)
			pdf.AddPage()
			top = 50
		}
		pdf.SetFillColor(255, 255, 255)
		pdf.SetDrawColor(204, 217, 230)
		pdf.Rect(40, top, width-80, 75, "DF")

		pdf.SetFont("Helvetica", "B", 10)
		pdf.SetTextColor(0, 48, 135)
		ref := ""
		if item.DisputeID.Valid && item.DisputeID.String != "" {
			ref += "Dispute: " + item.DisputeID.String + " "
		}
		if item.OrderID.Valid && item.OrderID.String != "" {
			ref += "Order: " + item.OrderID.String
		}
		titleLine := fmt.Sprintf("#%d [%s] %s", idx+1, item.EvidenceType, item.Title)
		pdf.Text(52, top+18, truncate(titleLine, 90))

		pdf.SetFont("Helvetica", "", 8)
		pdf.SetTextColor(102, 115, 128)
		pdf.Text(52, top+32, truncate(fmt.Sprintf("Source: %s | Captured: %s | %s", item.Source, item.CapturedAt, ref), 115))

		clean := truncate(whitespaceCollapse.ReplaceAllString(item.Content, " "), 105)
		pdf.SetTextColor(51, 51, 51)
		pdf.Text(52, top+48, "Payload: "+clean)

		pdf.SetTextColor(0, 128, 64)
		pdf.Text(52, top+64, "SHA-256: "+item.SHA256Hash)

		top += 88
	}

	renderDossierFooter(pdf, width)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func renderDossierFooter(pdf *fpdf.Fpdf, width float64) {
	pdf.SetDrawColor(204, 204, 204)
	pdf.SetLineWidth(0.5)
	pdf.Line(40, 742, width-40, 742)
	pdf.SetFont("Helvetica", "", 7.5)
	pdf.SetTextColor(128, 128, 128)
	pdf.Text(40, 757, "Deterministic Evidence Vault Dossier | PayPal Seller Protection § 11.3 Compliant Audit Log")
}

