package payment

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
	"path/filepath"
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

func sidecarURL() string {
	if v := os.Getenv("SIDECAR_INGEST_URL"); v != "" {
		return v
	}
	return "http://127.0.0.1:8089/prove"
}

func spoolDir() string {
	if v := os.Getenv("ZK_SPOOL_DIR"); v != "" {
		return v
	}
	return "/tmp/zk-spool"
}

func getenvPtr(k string) *string {
	if v := os.Getenv(k); v != "" {
		return &v
	}
	return nil
}

func emitPoE(reqID string, input interface{}, output interface{}) {
	inBytes, _ := json.Marshal(input)
	outBytes, _ := json.Marshal(output)
	body := proofRequest{
		ServiceName:      ptrOrDefault("SERVICE_NAME", "payment"),
		ServiceNamespace: getenvPtr("SERVICE_NAMESPACE"),
		PodName:          getenvPtr("POD_NAME"),
		PodUID:           getenvPtr("POD_UID"),
		ImageDigest:      getenvPtr("IMAGE_DIGEST"),
		CodeVersion:      getenvPtr("CODE_VERSION"),
		CodeHash:         getenvPtr("CODE_HASH"),
		JarSHA256:        nil,
		ReqID:            reqID,
		Input:            string(inBytes),
		Output:           string(outBytes),
	}
	if err := postToSidecar(body); err != nil {
		_ = writeToSpool(body)
	}
}

func ptrOrDefault(envKey, def string) *string {
	if v := os.Getenv(envKey); v != "" {
		return &v
	}
	return &def
}

func postToSidecar(body proofRequest) error {
	b, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, sidecarURL(), bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bs, _ := ioutil.ReadAll(resp.Body)
		return fmt.Errorf("sidecar status %d: %s", resp.StatusCode, string(bs))
	}
	return nil
}

func writeToSpool(body proofRequest) error {
	_ = os.MkdirAll(spoolDir(), 0x755)
	b, _ := json.Marshal(body)
	ts := time.Now().UnixNano() / int64(time.Millisecond)
	fname := fmt.Sprintf("poe_%s_%d.json", sanitize(body.ReqID), ts)
	path := filepath.Join(spoolDir(), fname)
	return ioutil.WriteFile(path, b, 0x644)
}

func sanitize(s string) string {
	return s
}
