# Contributing to Whetstone

Whetstone is opinionated software. Contributions are welcome, but only if they meet the bar.

## The Bar

1. **Solve a real problem.** If you can't point to a concrete failure mode or limitation that your change addresses, it doesn't belong here. "It would be nice if..." is not sufficient.

2. **Include tests.** Every behavioural change needs a test that proves it works. No exceptions.

3. **Don't break safety.** The immutability system, rollback mechanism, and approval gates exist for good reasons. Any change that weakens them will be rejected immediately.

4. **Write clearly.** British English. Oxford commas. No em dashes. No jargon without explanation. If Jason Zweig wouldn't publish it, rewrite it.

## Style Guide

### Code

- TypeScript with strict mode
- Explicit types (no `any` unless absolutely unavoidable)
- Functions under 40 lines
- Comments explain *why*, not *what*

### Documentation

- Active voice
- Present tense
- One idea per paragraph
- Concrete examples over abstract descriptions
- British spellings (behaviour, not behavior; organisation, not organization)

### Commits

- Imperative mood: "Add signal classifier" not "Added signal classifier"
- One logical change per commit
- Reference the issue number if one exists

## Development Setup

```bash
git clone https://github.com/prasants/whetstone.git
cd whetstone
npm install
npm test
```

## Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch from `main`
3. Write your changes with tests
4. Run `npm test` and ensure everything passes
5. Open a pull request with a clear description of what and why
6. Wait for review

## Reporting Issues

If you've found a bug:

1. Check existing issues first
2. Include: what you expected, what happened, and steps to reproduce
3. Include your Node.js version, OS, and Ollama version if relevant

## Licence

By contributing, you agree that your contributions will be licensed under the MIT Licence.
