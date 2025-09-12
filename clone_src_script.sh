#!/bin/bash
set -e

# Base GitHub URL for all microservices
BASE_URL="https://github.com/microservices-demo"

# Define your microservices: "name branch"
SERVICES=(
  "carts"
  "catalogue"
  "orders"
  "payment"
  "shipping"
  "user"
  "front-end"
)

for service in "${SERVICES[@]}"; do
  set -- $service
  NAME=$1
  BRANCH="master"
  URL="$BASE_URL/$NAME"

  echo "=== Adding/updating $NAME from $URL ($BRANCH) ==="

  # Add remote if not already added
  if ! git remote | grep -q "^$NAME$"; then
    git remote add $NAME $URL
  fi

  # Fetch latest branch
  git fetch $NAME $BRANCH

  # If folder already exists, merge instead of add
  if [ -d "src/$NAME" ]; then
    echo "Merging updates into src/$NAME..."
    git subtree pull --prefix=src/$NAME $NAME $BRANCH --squash
  else
    echo "Adding new subtree at src/$NAME..."
    git subtree add --prefix=src/$NAME $NAME $BRANCH --squash
  fi
done

echo "✅ All services processed!"
