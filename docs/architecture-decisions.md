# Architecture decisions

Answers from the `factory-init` interview, and the rules each one
produced. Change an answer here and re-run `sf init --answers` rather
than editing the generated policy by hand: the answer is the decision,
the policy is its consequence.

## How does the client fetch server data?

**Hand-rolled fetching**

Fetching inside an effect is the pattern that produces the race conditions, duplicate requests and stale reads a query cache exists to prevent — and it is what an agent writes when nothing says otherwise.

## Where does the client application live?

**app, components, lib**

The boundary rules need to know which directory is the client half, and a wrong answer makes them either silent or unbearable.

## Where does global client state live?

**No convention**

A store created inline in a component is invisible to everyone else and duplicates on re-render. One directory makes the whole of global state answerable by listing it.

## Which packages must the client never import directly?

**app/api/****

In a monorepo the first import of a database client into a component is not a compile error. It builds, it works in dev, and it either ships credentials into a browser bundle or drags a driver into the build.

## Where do error types get defined?

**No convention**

So that "what can this fail with?" is one file read rather than a search across services, repositories and handlers.

## Which files are generated, vendored or otherwise not hand-written?

**package-lock.json**

Editing a generated file by hand is the smallest possible fix and it silently forks the artifact from its source. The lock makes that impossible rather than discouraged.

## What is this repository?

**A web client**

It decides which rule families can mean anything here. Half the catalog is about an HTTP surface that a CLI does not have.

## What validates data crossing the boundary?

**Zod**

A schema is the only place a boundary is actually described. Where the schemas live decides whether that description is findable.

## Where do request and response schemas live?

**In one central schemas module**

Schemas dumped in a shared types module stop being about any one endpoint, and the boundary they described becomes unfindable from the handler that owns it.
