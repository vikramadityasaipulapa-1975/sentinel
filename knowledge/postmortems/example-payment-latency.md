# Fictional example: payment latency exceeded the checkout deadline

## Scope

Fictional teaching postmortem, not a record of a real production incident. Applies to checkout-service and payment-service. It supplies background guidance, not current incident evidence.

## Symptoms

In this invented scenario checkout returned 504 responses while payment requests completed later. Operators initially assumed payments had failed completely.

## Possible causes

The scenario's labelled cause was injected downstream latency exceeding the caller deadline. A late successful payment explained why retrying with a different key would have risked duplicate charges.

## Checks

The fictional investigation compared caller and payment span durations, matched request IDs and checked the same idempotency key. It distinguished an expired caller deadline from a downstream transaction result. No inference about the user's actual system follows from this example.

## Remediation guidance

The teaching response was to preserve idempotency, review latency and timeout budgets, and require approval before changes. In a real incident the operator must gather fresh evidence and follow backend authorization rather than replay this story's response automatically.

## Limitations

All events in this document are invented for training. Its cause must never be cited as proof that a current timeout has the same cause. It authorizes no commands, refunds, configuration changes or deployment action.
