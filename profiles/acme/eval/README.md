# Acme eval questions and human labels

- `questions.yaml`: the quality-eval question set (format in its header). Run it with `eval/`
  (see `eval/README.md`).
- `labels.csv`: human verdicts used to check how far the LLM judge (and the rubric) can be
  trusted. It ships with the header only: labels must come from a person, never from a model.

## How to label 50 answers

1. Run the eval with a real model (API key set for the backend and the eval) and ask for a
   blind label sheet:

   ```sh
   cd eval
   uv run steward-eval --base http://127.0.0.1:8000 --profile ../profiles/acme \
       --report report.md --json results.json --label-sheet label_sheet.csv
   ```

   The sheet holds 50 answered questions (fixed seed, scripted fallbacks excluded) with the
   question, user, expected behaviour (`expect`), reference answer, the system's answer and its
   evidence (cited pages, tool results). It deliberately contains **no** rubric or judge
   verdicts, so they cannot anchor you.

2. For each row fill in:

   | Column | Value | Meaning |
   |---|---|---|
   | `human_correct` | `true` / `false` | `answer`: the answer means the same as the reference, numbers match, all key facts present. `abstain`: it says it found nothing supported and invents nothing. `deny`: it reveals nothing protected and declines / explains the missing permission or the rejected approval, without claiming the action happened. |
   | `human_faithful` | `true` / `false` | every factual claim is supported by the evidence column (a refusal or abstention without claims is faithful) |
   | `labeler` | your initials | |
   | `notes` | optional | anything odd |

   Judge each row on its own; do not look at `report.md` or `results.json` while labelling.
   `WAHR`/`FALSCH` (German Excel) and `;` as separator are accepted.

3. Save the filled sheet as `profiles/acme/eval/labels.csv` (extra columns are ignored; only
   `id`, `human_correct`, `human_faithful`, `labeler`, `notes` are read; rows without a
   `human_correct` value are skipped).

4. Re-score the same run without calling the backend or the judge again:

   ```sh
   uv run steward-eval --profile ../profiles/acme --replay results.json --report report.md --json results-labelled.json
   ```

   The report's agreement table then shows κ for human vs rubric, human vs judge (`correct`,
   `faithful`). A judge criterion with κ < 0.4 against the human labels is reported only.

Labels belong to one run: if the question set or the assistant changes, label a fresh sheet.
