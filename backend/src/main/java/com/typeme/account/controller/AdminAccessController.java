package com.typeme.account.controller;

import com.typeme.account.repository.UserRepository;
import com.typeme.common.ApiException;
import com.typeme.platform.service.PlatformQueryService;
import com.typeme.platform.api.PlatformDtos;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v3/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminAccessController {
    private final CurrentUser current;
    private final UserRepository users;
    private final PlatformQueryService platform;
    public AdminAccessController(CurrentUser current, UserRepository users, PlatformQueryService platform) {
        this.current = current; this.users = users; this.platform = platform;
    }
    private <T> ResponseEntity<T> response(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
    private String target(String userId) {
        current.require();
        users.findById(userId).filter(u -> !"DELETED".equals(u.status())).orElseThrow(ApiException::notFound);
        return userId;
    }
    private <T> T query(java.util.function.Supplier<T> read) {
        try { return read.get(); }
        catch (com.typeme.jung.service.JungApiException ex) {
            // The platform advice is package-scoped; preserve its status at this admin boundary.
            throw new ApiException(ex.code(), org.springframework.http.HttpStatus.valueOf(ex.httpStatus()), ex.getMessage(), ex.details());
        }
    }
    @GetMapping("/users/{userId}/attempts")
    public ResponseEntity<PlatformDtos.MyAttemptListResponse> attempts(@PathVariable String userId, @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="20") int size) {
        return response(query(() -> platform.myAttempts(target(userId), Math.min(Math.max(page, 0), 100000), size)));
    }
    @GetMapping("/users/{userId}/reports")
    public ResponseEntity<PlatformDtos.MyReportListResponse> reports(@PathVariable String userId, @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="20") int size) {
        return response(query(() -> platform.myReports(target(userId), Math.min(Math.max(page, 0), 100000), size)));
    }
    @GetMapping("/users/{userId}/reports/{reportId}")
    public ResponseEntity<PlatformDtos.ReportDetailView> report(@PathVariable String userId, @PathVariable String reportId) {
        // Admin-only entry; reuse owner-bound query, never weaken ordinary report endpoints.
        return response(query(() -> platform.report(target(userId), reportId)));
    }
}
