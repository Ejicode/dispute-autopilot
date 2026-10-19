package ai

// ReasonEvidenceRequirement describes what PayPal expects for a dispute reason.
type ReasonEvidenceRequirement struct {
	Reason            string   `json:"reason"`
	PrimaryEvidence   []string `json:"primaryEvidence"`
	SecondaryEvidence []string `json:"secondaryEvidence"`
	Description       string   `json:"description"`
}

// EvidenceRequirements maps each dispute reason to its expected evidence.
var EvidenceRequirements = map[string]ReasonEvidenceRequirement{
	"MERCHANDISE_OR_SERVICE_NOT_RECEIVED": {
		Reason:            "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
		PrimaryEvidence:   []string{"TRACKING_HISTORY", "PROOF_OF_DELIVERY"},
		SecondaryEvidence: []string{"ORDER_CONFIRMATION", "CUSTOMER_COMMUNICATION"},
		Description:       "Buyer claims item was not delivered. PayPal requires online tracking showing delivery to buyer address.",
	},
	"MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
		Reason:            "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
		PrimaryEvidence:   []string{"ORDER_CONFIRMATION", "REFUND_POLICY"},
		SecondaryEvidence: []string{"CUSTOMER_COMMUNICATION", "TRACKING_HISTORY"},
		Description:       "Buyer claims item is significantly not as described or damaged.",
	},
	"UNAUTHORISED": {
		Reason:            "UNAUTHORISED",
		PrimaryEvidence:   []string{"PROOF_OF_DELIVERY", "DEVICE_FINGERPRINT"},
		SecondaryEvidence: []string{"ORDER_CONFIRMATION", "CUSTOMER_COMMUNICATION"},
		Description:       "Account holder claims they did not authorize the payment.",
	},
	"INCORRECT_AMOUNT": {
		Reason:            "INCORRECT_AMOUNT",
		PrimaryEvidence:   []string{"ORDER_CONFIRMATION"},
		SecondaryEvidence: []string{"CUSTOMER_COMMUNICATION"},
		Description:       "Buyer claims charged amount was incorrect.",
	},
	"DUPLICATE_TRANSACTION": {
		Reason:            "DUPLICATE_TRANSACTION",
		PrimaryEvidence:   []string{"ORDER_CONFIRMATION"},
		SecondaryEvidence: []string{"CUSTOMER_COMMUNICATION"},
		Description:       "Buyer claims duplicate charge for same purchase.",
	},
	"BUYER_CANCELLED_SERVICE": {
		Reason:            "BUYER_CANCELLED_SERVICE",
		PrimaryEvidence:   []string{"REFUND_POLICY", "CUSTOMER_COMMUNICATION"},
		SecondaryEvidence: []string{"ORDER_CONFIRMATION"},
		Description:       "Buyer claims recurring subscription was cancelled before charge.",
	},
	"OTHER": {
		Reason:            "OTHER",
		PrimaryEvidence:   []string{"ORDER_CONFIRMATION", "PROOF_OF_DELIVERY"},
		SecondaryEvidence: []string{"CUSTOMER_COMMUNICATION"},
		Description:       "Other dispute reason.",
	},
}
