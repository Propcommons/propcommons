#!/usr/bin/env node
// Prop Commons reserves this package name so nobody else can publish code under it.
// The real tools run inside a clone of the repository, where `npx propcommons` uses the local copy.
console.error(`This is the placeholder "propcommons" package from npm.

The Prop Commons tools run inside your copy of the project:

  gh repo fork Propcommons/propcommons --clone
  cd propcommons
  npm ci
  npx propcommons help

Inside that folder, "npx propcommons" uses the project's own tools instead of this package.
Guide: https://github.com/Propcommons/propcommons/blob/main/CONTRIBUTING.md`);
process.exit(1);
