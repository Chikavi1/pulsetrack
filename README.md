# PulseTrack

[![npm version](https://img.shields.io/npm/v/pulsetrack.svg?style=flat-square)](https://www.npmjs.com/package/pulsetrack)
[![TypeScript](https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg?style=flat-square)](https://www.typescriptlang.org/)

PulseTrack is an analytics and feedback collection library designed for modern web applications. It provides developers with powerful tools to understand user behavior, collect feedback, and make data-driven decisions.

## ✨ Features

- 📊 **Comprehensive Analytics**
  - Page view and navigation tracking
  - User interaction monitoring (clicks, form submissions, etc.)
  - Custom event tracking
  - Session management

- 💬 **User Feedback**
  - Built-in feedback widgets
  - Customizable feedback forms
  - Screenshot capture for visual feedback
  - User metadata collection

- 🚀 **Developer Friendly**
  - TypeScript support
  - Framework agnostic (works with React, Vue, Angular, etc.)
  - Extensible plugin system
  - Detailed documentation

## 📦 Installation

Install PulseTrack using npm:

```bash
npm install pulsetrack
```
or
```bash
yarn add pulsetrack
```

## 🚀 Quick Start

```typescript
import { PulseTrack } from 'pulsetrack';

// Initialize with your configuration
const tracker = new PulseTrack({
  token: 'your-token-id'
});

// Track a custom event
tracker.addTag('user_action', { action: 'button_click', buttonId: 'cta-button' });
```

## 📚 Documentation

For detailed documentation, please visit our [documentation website](https://docs.rojastudio.xyz).

### Available Plugins

- **Analytics**: Core tracking functionality
- **Feedback**: User feedback collection
- **Performance**: Page load and resource timing
- **Error Tracking**: JavaScript error monitoring

## 🔧 Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | string | - | Your token identifier (required) |
 