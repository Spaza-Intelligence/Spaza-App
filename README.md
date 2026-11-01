# Spanza-App
Spaza Shop Management System - Frontend

## Overview
Frontend for Spanza App built with modern web tech. Manages inventory, sales, and customers for spaza shops.

## Branches
- `main` - stable production version
- `develop` - active development

## CI/CD Pipeline
Automated with GitHub Actions:
- Workflow: `.github/workflows/ci.yml`
- Triggers: push to `main` and `develop`
- Steps: Checkout -> Setup Node.js 20 -> Install dependencies -> Build

Check Actions tab for build status.

## Tech Stack
- Frontend Framework: React / Vanilla JS
- Node.js 20
- GitHub Actions for CI

## Setup
```bash
npm install
npm run build
