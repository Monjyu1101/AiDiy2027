#!/bin/bash

# SSL Certificate Generation Script
# Generates self-signed SSL certificates for development

SSL_DIR="./ssl"
COUNTRY="JP"
STATE="Tokyo"
CITY="Tokyo"
ORGANIZATION="RiKi AiDiy"
ORGANIZATIONAL_UNIT="Development"
COMMON_NAME="kondou-envy.local"
EMAIL="admin@localhost"

echo "Generating SSL certificates..."

# Create SSL directory
mkdir -p $SSL_DIR

# Generate private key
openssl genrsa -out $SSL_DIR/key.pem 2048

# Generate certificate signing request (CSR)
openssl req -new -key $SSL_DIR/key.pem -out $SSL_DIR/cert.csr -subj "/C=$COUNTRY/ST=$STATE/L=$CITY/O=$ORGANIZATION/OU=$ORGANIZATIONAL_UNIT/CN=$COMMON_NAME/emailAddress=$EMAIL"

# Generate self-signed certificate (valid for 365 days)
openssl x509 -req -days 365 -in $SSL_DIR/cert.csr -signkey $SSL_DIR/key.pem -out $SSL_DIR/cert.pem

# Remove CSR file
rm $SSL_DIR/cert.csr

echo "SSL certificates generated successfully:"
echo "  Certificate: $SSL_DIR/cert.pem"
echo "  Private Key: $SSL_DIR/key.pem"
echo ""
echo "NOTE: This is a self-signed certificate for development use only."
echo "For production, use certificates issued by a trusted Certificate Authority."