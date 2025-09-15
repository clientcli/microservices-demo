package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

type proofRequest struct {
	ServiceName      *string `json:"service_name,omitempty"`
	ServiceNamespace *string `json:"service_namespace,omitempty"`
	PodName          *string `json:"pod_name,omitempty"`
	PodUID           *string `json:"pod_uid,omitempty"`
	ImageDigest      *string `json:"image_digest,omitempty"`
	CodeVersion      *string `json:"code_version,omitempty"`
	CodeHash         *string `json:"code_hash,omitempty"`
	JarSHA256        *string `json:"jar_sha256,omitempty"`
	ReqID            string  `json:"req_id"`
	Input            string  `json:"input"`
	Output           string  `json:"output"`
}

type proofResponse struct {
	Status       string `json:"status"`
	ProofID      string `json:"proof_id"`
	Commitment   string `json:"commitment"`
	GeneratedAt  string `json:"generated_at"`
	ServiceName  string `json:"service_name"`
	PodName      string `json:"pod_name"`
}

func listenAddr() string {
	if v := os.Getenv("LISTEN_ADDR"); v != "" {
		return v
	}
	// Bind to loopback by default to ensure same-pod access only
	return "127.0.0.1:8089"
}

func handlerProve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	var req proofRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid json"}`))
		return
	}

	serviceName := valueOr(req.ServiceName, os.Getenv("SERVICE_NAME"))
	podName := valueOr(req.PodName, os.Getenv("POD_NAME"))

	commitment := computeCommitment(req)
	resp := proofResponse{
		Status:      "ok",
		ProofID:     hashString(fmt.Sprintf("%s|%s|%s|%d", serviceName, req.ReqID, commitment, time.Now().UnixNano())),
		Commitment:  commitment,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		ServiceName: serviceName,
		PodName:     podName,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func handlerHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func computeCommitment(req proofRequest) string {
	// Placeholder for ZK proof commitment derivation.
	// Deterministically hash key fields to simulate a commitment.
	secret := os.Getenv("POE_SECRET")
	parts := []string{
		valueOr(req.ServiceName, ""),
		valueOr(req.ServiceNamespace, ""),
		valueOr(req.PodName, ""),
		valueOr(req.PodUID, ""),
		valueOr(req.ImageDigest, ""),
		valueOr(req.CodeVersion, ""),
		valueOr(req.CodeHash, ""),
		req.ReqID,
		req.Input,
		req.Output,
		secret,
	}
	return hashString(strings.Join(parts, "|"))
}

func hashString(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func valueOr(p *string, def string) string {
	if p != nil && *p != "" {
		return *p
	}
	return def
}

func main() {
	http.HandleFunc("/prove", handlerProve)
	http.HandleFunc("/health", handlerHealth)
	addr := listenAddr()
	log.Printf("poe-sidecar listening on %s", addr)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

