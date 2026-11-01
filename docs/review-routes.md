# Review route design

A route is a reading order over the changed files, not a replacement directory layout. Infer platform, framework, and reading order from repository evidence. Users choose only Files or Change route. Framework recognition supplies clues, and package boundaries keep different stacks separate. Unknown files remain visible.

## Frontend

| Stack | Proposed route | Future semantic adapter requirements |
| --- | --- | --- |
| React | Data/API → hooks and state → components/styles → pages/navigation → tests | Resolve imports, hooks, context/store use, and JSX props. Next.js server/client boundaries need their own adapter. |
| Vue | Data/API → composables/stores → components/styles → views/router → tests | Parse SFC script/template/style, props/emits, composables and store usage; handle Options API as well as Composition API. |
| Angular | Data/API → services/state → components/templates/styles → routes/guards → tests | Read decorators, DI, template bindings and route configuration. Keep companion HTML/CSS close to their component. |

Do not infer the whole architecture from folder names. Angular's current style guide recommends grouping by feature and avoiding generic component/service directory buckets. Vue can place several responsibilities in one SFC. React does not make a particular repository folder structure a prerequisite. Therefore, a fixed folder-to-layer table is only a first approximation.

The local tool detects manifests and framework-specific source signals per package, then orders real diffs by conventions. There is no framework selector. Full semantic support still requires syntax and dependency adapters.

Sources: [Angular style guide](https://angular.dev/style-guide), [Vue composables](https://vuejs.org/guide/reusability/composables), [Vue state management](https://vuejs.org/guide/scaling-up/state-management), [Thinking in React](https://react.dev/learn/thinking-in-react).

## Backend

Initial stack targets are TypeScript/NestJS, Python/FastAPI and Java/Spring. This is a product coverage choice, not a measured popularity ranking: TypeScript shares frontend tooling, Python adds a dynamic-language case, and Java adds typed enterprise conventions. C#/ASP.NET and Go remain plausible subsequent targets; prioritize them from actual users rather than adding shallow language claims.

| Review preset | Proposed reading order | Important qualification |
| --- | --- | --- |
| Layered services | Contract → implementation → consumers/entry points → tests | The original compact route. Persistence is inside implementation for now; database migrations may need their own stage. |
| Clean / Hexagonal | Domain/contracts → use cases/ports → adapters/infrastructure → entry points → tests | These architectures share dependency-inversion ideas but are not identical. The combined preset is a reading convenience. |
| Event-driven | Event contracts → producers → transport/delivery → consumers → tests | A communication style that can coexist with either of the above. Review idempotency, retries and schema compatibility. |

Nest modules describe composition and boundaries, Spring stereotypes describe roles, and FastAPI routers describe entry points. None determines an entire architecture. A future adapter must combine those signals with imports, calls, DI and project configuration. For larger mixed diffs, group by feature or change intent first, then by layer; otherwise unrelated contracts are pulled away from their implementations.

Sources: [Nest modules](https://docs.nestjs.com/modules), [FastAPI larger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/), [Spring DAO support](https://docs.spring.io/spring-framework/reference/data-access/dao.html), [Microsoft architecture guide](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures).

## Mobile

MVVM describes presentation responsibilities: Model, View, ViewModel. It is not a universal architecture for every mobile app, nor does it dictate repositories, network clients, navigation or a separate domain layer. UDF describes how state and events flow, and can be used with MVVM. Treat them as alternate review focuses, not exclusive app types.

- State-holder focus: models/contracts → data/repositories → optional use cases → screen state/ViewModel → screens/navigation → tests.
- Event-flow focus: models/contracts → data/repositories → actions/reducers → screen state → screens/navigation → tests.

The local tool recognizes Android, SwiftUI/UIKit and Flutter signals. Missing layers are omitted. A small screen should not acquire a fake use-case layer simply to fill a template. Kotlin lifecycle/Flow, Swift observation/actor isolation, and Flutter notifier/BLoC conventions require separate semantic adapters. The current path heuristics do not validate those behaviors.

Sources: [Android architecture](https://developer.android.com/topic/architecture), [Android optional domain layer](https://developer.android.com/topic/architecture/domain-layer), [Flutter architecture and MVVM](https://docs.flutter.dev/app-architecture/guide).

## Implementation sequence

1. Current: automatic per-package detection, convention-based classification, continuous real Git diffs, validated line comments, and same-session agent feedback.
2. Next: parse TypeScript/JSX, Vue SFCs and Angular templates/decorators; retain calibrated confidence and evidence for each role.
3. Then: group by feature, build dependency edges and topologically order changes. Handle cycles as groups and keep unknowns visible.
4. Expand backend/mobile syntax adapters using real repositories and labeled review fixtures. Evaluate misclassifications before advertising full support.
5. Preserve and re-anchor comments across revisions using file identity and code context; report ambiguous matches rather than silently moving feedback.
