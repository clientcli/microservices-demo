FROM golang:1.22 as builder
WORKDIR /src
COPY go.mod ./
COPY go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/poe-sidecar

FROM gcr.io/distroless/static:nonroot
USER 65532:65532
COPY --from=builder /out/poe-sidecar /poe-sidecar
ENV LISTEN_ADDR=127.0.0.1:8089
ENTRYPOINT ["/poe-sidecar"]
