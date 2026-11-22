<div align="center">
  <h1>🦉 Discava</h1>
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

**Discava is a free, open source learning platform designed around AI from the start, and it runs entirely in your own AWS account.** The courses, the learner data and the AI that works with them all stay with you.

- **AI at the core** *(coming soon)*: an assistant built into the learning experience, not bolted on as a plugin.
- **Scales to zero**: fully serverless, so you pay for what you use and next to nothing when no one is learning.
- **Scales up too**: the same deployment grows from your first student to your ten-thousandth, with no servers to manage.
- **Sell or share**: publish free or paid courses, and get paid through Stripe.
- **Teach your way**: video lessons with questions along the way, quizzes and graded assignments.
- **Keep learners moving**: progress tracking, a searchable transcript for every video, and certificates they can share.

> [!IMPORTANT]
> Discava is under active development and is not yet feature complete. Expect breaking changes and rough edges until a stable release is tagged.

## Why Discava

- ☁️ **Serverless.** Pay for what you use. It scales to zero.
- 🔒 **Your AWS account.** You own your data.
- 🛡️ **Hardened production defaults.** WAF and KMS encryption.
- 🆓 **Free and open source.** Apache 2.0.
- 🤖 **Built with AI in mind** from the start.

## What you get

### 🎓 For learners

- 🔍 Browse a course catalogue by category, or search with suggestions as you type
- 👀 Watch free preview lessons before you enrol
- 💳 Enrol in free courses, or buy paid ones with Stripe Checkout, and ask for a refund if it isn't for you
- 🎬 Adaptive HD video with auto-generated captions, translated into the course's other languages, playback speeds and keyboard shortcuts
- 📜 Read a video's transcript alongside it, search what was said across a course, and jump to that moment
- ❓ Answer questions that pause the video as you watch, and see where they are on the timeline
- 📝 Quizzes and assignment submissions, with late submissions flagged, and grades and feedback when your work is returned
- 📊 Progress tracking that shows how far you are through each course
- 🏆 Certificates when you complete a course, with what's still needed shown as you go
- 🔗 Anyone with the link can verify a certificate and see what it assessed
- 💼 Add your certificate to LinkedIn in one click
- ⭐ Rate and review the courses you take
- 💬 Discuss lessons with your instructor and classmates, and get notified of replies and accepted answers
- 🔔 Notifications and 📣 announcements, so you never miss an update

### 📚 For instructors

- 🎬 Build courses from video, text, files, quizzes and assignments, and add questions to a video's timeline
- ✏️ Edit your course live and publish a public landing page for it, with a preview video and your instructor profile, server-rendered so search engines can find it
- 👀 Mark lessons as free previews that anyone can watch before enrolling
- 🌐 Choose the languages your videos' captions are machine-translated into; a caption file you upload always wins
- 👋 Set a prompt in the first lesson to get learners started, and see how many answered it
- 🏆 Choose whether your course awards certificates, what counts towards completion, and whether every quiz must be passed
- 💰 Set a price, track your earnings and refunds, and get paid out through Stripe
- 📊 An instructor dashboard with enrolment and activity trends, and the lessons where learners drop off
- ✅ Grade assignment submissions from a queue on your home page, return feedback, and get one notification a day when new work comes in
- 💬 Answer lesson discussions and respond to reviews
- 📣 Post announcements to your enrolled learners

### 🛡️ For admins

- 🗂️ Manage the category taxonomy that organises the catalogue
- ⭐ Moderate course reviews from one admin portal
- 💳 Connect Stripe from the admin portal's Payments page, with no secrets to set by hand

> [!TIP]
> 🤖 **AI built in, not bolted on.** ✨ An AI assistant and personalised learning are part of the core experience, not a paid add-on. Coming soon.

### 🧑‍💻 For developers

Discava is a TypeScript monorepo. It is opinionated by design: one cloud provider, one way to deploy.

- 🐳 Everything runs locally with Docker. No AWS account needed to try it.
- 🚀 One command deploys it to AWS with CDK.
- 🧱 Built with the [Nx Plugin for AWS](https://github.com/awslabs/nx-plugin-for-aws), so every API, portal and stack is scaffolded the same way, following AWS's proven best practices.
- ✅ Well tested.

#### Try it locally

With Docker running:

```sh
pnpm i
pnpm dev
```

Then open a portal:

| Portal | URL |
| --- | --- |
| Student | http://localhost:4201 |
| Instructor | http://localhost:4200 |
| Admin | http://localhost:4202 |

Sign in as Alice (instructor and student), Bob or Dan (students) or Carol (admin). Payments work locally too, with a stand-in for Stripe.

See the docs and [DEVELOPMENT.md](DEVELOPMENT.md) for everything else.

## Documentation

Architecture and guides live at the [Discava docs site](https://alexto.github.io/discava/).

## License

Apache License 2.0, see [LICENSE](LICENSE).

## Contributing

Discava doesn't accept outside pull requests or issues. Changes come from a strict, automated development pipeline, documented at [AlexTo/agentic-sdlc](https://github.com/AlexTo/agentic-sdlc). Only collaborators can open issues or pull requests: agents act on both, so this keeps prompt injection out of the pipeline.

Ideas, questions and bug reports are welcome in [Discussions](https://github.com/AlexTo/discava/discussions). See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
