{{/*
Construct DATABASE_URL from postgresql values or external URL.
Usage: {{ include "wytui.databaseUrl" . }}
*/}}
{{- define "wytui.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
postgresql://{{ .Values.postgresql.secret.username }}:{{ .Values.postgresql.secret.password }}@wytui-postgresql:5432/{{ .Values.postgresql.database }}?schema=public
{{- else -}}
{{ .Values.postgresql.secret.url }}
{{- end -}}
{{- end }}

{{/*
Common app environment variables from secret.
Usage: {{- include "wytui.appEnv" . | nindent 8 }}
*/}}
{{- define "wytui.appEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      {{- if .Values.postgresql.secret.existing }}
      name: {{ .Values.postgresql.secret.name }}
      {{- else }}
      name: {{ .Values.secret.name }}
      {{- end }}
      key: {{ .Values.postgresql.secret.urlKey }}
- name: AUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secret.name }}
      key: {{ .Values.secret.authSecretKey }}
- name: AUTH_TRUST_HOST
  value: "true"
- name: NODE_ENV
  value: "production"
{{- if .Values.oidc.enabled }}
- name: OIDC_DISPLAY_NAME
  value: {{ .Values.oidc.name | quote }}
- name: OIDC_CLIENT_ID
  valueFrom:
    secretKeyRef:
      name: {{ .Values.oidc.secret.name }}
      key: {{ .Values.oidc.secret.clientIdKey }}
- name: OIDC_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ .Values.oidc.secret.name }}
      key: {{ .Values.oidc.secret.clientSecretKey }}
- name: OIDC_ISSUER_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.oidc.secret.name }}
      key: {{ .Values.oidc.secret.issuerKey }}
{{- end }}
{{- end }}
