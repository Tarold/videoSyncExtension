#!/bin/bash
# Initialize PostgreSQL database schema for Video Sync Server

# Check if psql is available
if ! command -v psql &> /dev/null; then
    echo "Error: psql not found. Please install PostgreSQL."
    exit 1
fi

# Load environment variables
if [ ! -f .env ]; then
    echo "Error: .env file not found. Please create it first."
    exit 1
fi

source .env

# Execute schema
echo "Creating database schema..."
psql -U $DB_USER -d $DB_NAME -h $DB_HOST -f sql/schema.sql

if [ $? -eq 0 ]; then
    echo "✓ Database schema created successfully!"
else
    echo "✗ Error creating database schema."
    exit 1
fi
