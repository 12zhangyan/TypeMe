package com.typeme.platform;

import com.typeme.account.AccountIntegrationTestBase;
import com.typeme.jung.api.JungDtos;
import com.typeme.jung.service.*;
import com.typeme.platform.api.PlatformDtos;
import com.typeme.platform.catalog.AssessmentCatalog;
import com.typeme.platform.service.BigFiveAttemptService;
import com.typeme.platform.service.BigFiveReportService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

/** 真实服务事务 + 独立 H2；不连接 MySQL。用持锁事务控制两条请求的先后。 */
class AssessmentConcurrencyH2IT extends AccountIntegrationTestBase {
    @Autowired AttemptService jung;
    @Autowired ReportService jungReports;
    @Autowired BigFiveAttemptService bigFive;
    @Autowired BigFiveReportService bigFiveReports;
    @Autowired AssessmentCatalog catalog;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlatformTransactionManager transactions;

    record Draft(String user, String id, String slug, String question) {}

    Draft draft(String slug, boolean complete) throws Exception {
        var account = register(uniqueUsername("race"), "Synthetic-Race!2026");
        assertThat(account.status()).isEqualTo(201);
        String user = jdbc.queryForObject("SELECT user_id FROM app_user_session WHERE session_id = ?",
                String.class, account.session().getId());
        var release = catalog.defaultRelease(slug);
        String id = "jung48".equals(slug)
                ? jung.create(user, null, null, release).attemptId()
                : bigFive.create(user, null, null, release).attemptId();
        var base = release.items().stream().filter(item -> "base".equals(item.stage())).toList();
        if (complete) {
            if ("jung48".equals(slug)) {
                jung.patchAnswers(user, id, new JungDtos.PatchAnswersRequest(0L, null,
                        base.stream().map(item -> new JungDtos.ResponseInput(item.id(), "RATING", 4)).toList()));
            } else {
                bigFive.patchAnswers(user, id, new PlatformDtos.PatchAnswersRequest(0L, null,
                        base.stream().map(item -> new PlatformDtos.ResponseInput(item.id(), "RATING", 4)).toList()));
            }
        }
        return new Draft(user, id, slug, base.getFirst().id());
    }

    void patch(Draft draft, long revision, int rating) {
        if ("jung48".equals(draft.slug)) {
            jung.patchAnswers(draft.user, draft.id, new JungDtos.PatchAnswersRequest(revision, null,
                    List.of(new JungDtos.ResponseInput(draft.question, "RATING", rating))));
        } else {
            bigFive.patchAnswers(draft.user, draft.id, new PlatformDtos.PatchAnswersRequest(revision, null,
                    List.of(new PlatformDtos.ResponseInput(draft.question, "RATING", rating))));
        }
    }

    void submit(Draft draft, long revision) {
        if ("jung48".equals(draft.slug)) {
            jungReports.submit(draft.user, draft.id, new JungDtos.SubmitRequest(revision, true));
        } else {
            bigFiveReports.submit(draft.user, draft.id, new PlatformDtos.SubmitRequest(revision));
        }
    }

    String outcome(Runnable action) {
        try { action.run(); return "OK"; }
        catch (JungApiException ex) { return ex.code(); }
    }

    @ParameterizedTest @ValueSource(strings = {"jung48", "bigfive50"})
    void competingWritersCannotBothSave(String slug) throws Exception {
        Draft draft = draft(slug, false);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var start = new CountDownLatch(1);
            Future<String> first = executor.submit(() -> { start.await(); return outcome(() -> patch(draft, 0, 1)); });
            Future<String> second = executor.submit(() -> { start.await(); return outcome(() -> patch(draft, 0, 5)); });
            start.countDown();
            String a = first.get(10, TimeUnit.SECONDS), b = second.get(10, TimeUnit.SECONDS);
            assertThat(List.of(a, b)).containsExactlyInAnyOrder("OK", "CONFLICT_REVISION");
            assertThat(jdbc.queryForObject("SELECT rating FROM assessment_answer WHERE attempt_id=? AND question_id=?",
                    Integer.class, draft.id, draft.question)).isEqualTo("OK".equals(a) ? 1 : 5);
        }
    }

    @ParameterizedTest @ValueSource(strings = {"jung48", "bigfive50"})
    void submissionWaitsForWriterThenRejectsStaleRevision(String slug) throws Exception {
        Draft draft = draft(slug, true);
        try (var executor = Executors.newSingleThreadExecutor()) {
            var started = new CountDownLatch(1);
            var future = new java.util.concurrent.atomic.AtomicReference<Future<String>>();
            new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                jung.requireRowForUpdate(draft.user, draft.id);
                future.set(executor.submit(() -> {
                    started.countDown();
                    return outcome(() -> submit(draft, 1));
                }));
                assertThatCode(() -> assertThat(started.await(5, TimeUnit.SECONDS)).isTrue()).doesNotThrowAnyException();
                assertThatThrownBy(() -> future.get().get(300, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
                patch(draft, 1, 5);
            });
            assertThat(future.get().get(10, TimeUnit.SECONDS)).isEqualTo("CONFLICT_REVISION");
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM assessment_report WHERE attempt_id=?", Integer.class, draft.id)).isZero();
        }
    }

    @ParameterizedTest @ValueSource(strings = {"jung48", "bigfive50"})
    void writerWaitingForSubmissionCannotChangeFrozenAnswers(String slug) throws Exception {
        Draft draft = draft(slug, true);
        try (var executor = Executors.newSingleThreadExecutor()) {
            var future = new java.util.concurrent.atomic.AtomicReference<Future<String>>();
            new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                jung.requireRowForUpdate(draft.user, draft.id);
                future.set(executor.submit(() -> outcome(() -> patch(draft, 1, 1))));
                submit(draft, 1);
            });
            assertThat(future.get().get(10, TimeUnit.SECONDS)).isEqualTo("ATTEMPT_SUBMITTED");
            assertThat(jdbc.queryForObject("SELECT rating FROM assessment_answer WHERE attempt_id=? AND question_id=?",
                    Integer.class, draft.id, draft.question)).isEqualTo(4);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM assessment_report WHERE attempt_id=?", Integer.class, draft.id)).isEqualTo(1);
        }
    }

    @Test
    void clearingAnswerPersistsAndMakesSubmissionIncomplete() throws Exception {
        Draft draft = draft("bigfive50", true);
        bigFive.patchAnswers(draft.user, draft.id, new PlatformDtos.PatchAnswersRequest(1L, null,
                List.of(new PlatformDtos.ResponseInput(draft.question, "CLEAR", null))));
        assertThat(bigFive.detail(draft.user, draft.id).answers()).noneMatch(answer -> draft.question.equals(answer.questionId()));
        var result = bigFiveReports.submit(draft.user, draft.id, new PlatformDtos.SubmitRequest(2L));
        assertThat(result.status()).isEqualTo("INCOMPLETE");
        assertThat(result.incompleteQuestionIds()).containsExactly(draft.question);
        assertThat(result.reportId()).isNull();
    }
}
