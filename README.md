<div align="center">
  <h1>Discava</h1>
  <h3>Teach, learn and grow, on a platform you own.</h3>
  <p>The serverless, AI-native Learning Management System.</p>
  <a href="https://opensource.org/licenses/Apache-2.0">
    <img
      src="https://img.shields.io/badge/License-Apache%202.0-yellowgreen.svg"
      alt="Apache 2.0 License"
    />
  </a>
  <a href="https://codecov.io/github/AlexTo/discava">
    <img
      src="https://codecov.io/github/AlexTo/discava/graph/badge.svg?token=LOOB6GNM8P"
      alt="Codecov coverage"
    />
  </a>
  <a href="https://github.com/AlexTo/discava/actions/workflows/ci.yml">
    <img
      src="https://github.com/AlexTo/discava/actions/workflows/ci.yml/badge.svg"
      alt="Release badge"
    />
  </a>
  <a href="https://github.com/AlexTo/discava/commits/main">
    <img
      src="https://img.shields.io/github/commit-activity/w/AlexTo/discava"
      alt="Commit activity"
    />
  </a>
</div>

---

**Discava is a free, open source learning platform that runs in your own AWS account.** Publish free or paid courses, teach with video, quizzes and assignments, and let learners track their progress. An AI assistant is coming as part of the core experience.

> [!IMPORTANT]
> Discava is under active development and is not yet feature complete. Expect breaking changes and rough edges until a stable release is tagged.

## What you get

### 🎓 For learners

- 🔍 Browse a course catalogue by category, or search with suggestions as you type
- 💳 Enrol in free courses, or buy paid ones with Stripe Checkout
- 🎬 Adaptive HD video with captions, playback speeds and keyboard shortcuts
- 📝 Quizzes and assignment submissions, with late submissions flagged
- 📊 Progress tracking that shows how far you are through each course
- 🏆 Certificates when you complete a course
- ⭐ Rate and review the courses you take
- 💬 Discuss lessons with your instructor and classmates
- 🔔 Notifications and 📣 announcements, so you never miss an update

### 📚 For instructors

- 🎬 Build courses from video, text, files, quizzes and assignments
- ✏️ Edit your course live and publish a public landing page for it, with a preview video and your instructor profile
- 💰 Set a price, track your earnings and get paid through Stripe
- 📊 An instructor dashboard with course analytics
- 💬 Answer lesson discussions and respond to reviews
- 📣 Post announcements to your enrolled learners

### 🛡️ For admins

- 🗂️ Manage the category taxonomy that organises the catalogue
- ⭐ Moderate course reviews from one admin portal
- 💳 Connect your Stripe account from the admin portal, with no secrets to set by hand

> [!TIP]
> 🤖 **AI built in, not bolted on.** ✨ An AI assistant and personalised learning are part of the core experience, not a paid add-on. Coming soon.

## Why Discava

- ☁️ **Serverless.** Pay for what you use. It scales to zero.
- 🔒 **Your AWS account.** You own your data.
- 🛡️ **Hardened production defaults.** WAF and KMS encryption.
- 🆓 **Free and open source.** Apache 2.0.
- 🤖 **Built with AI in mind** from the start.

## For developers

Discava is a TypeScript monorepo. It is opinionated by design: one cloud provider, one way to deploy.

- 🐳 Everything runs locally with Docker. No AWS account needed to try it.
- 🚀 One command deploys it to AWS with CDK.
- ✅ Well tested.

### Try it locally

With Docker running:

```sh
pnpm i
pnpm dev
```

Sign in as Alice (instructor and student), Bob or Dan (students) or Carol (admin). Payments work locally too, with a stand-in for Stripe.

See the docs and [CONTRIBUTING.md](CONTRIBUTING.md) for everything else.

## Documentation

Architecture and guides live at the [Discava docs site](https://alexto.github.io/discava/).

## License

Apache License 2.0, see [LICENSE](LICENSE).

## Contributing

Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).
