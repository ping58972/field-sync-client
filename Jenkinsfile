pipeline {
    agent any
    stages {
        stage('Install') { steps { sh 'npm ci' } }
        stage('Typecheck and test') { steps { sh 'npm run typecheck && npm test' } }
        stage('Dependency check') { steps { sh 'npm audit --audit-level=moderate' } }
        stage('Android bundle') { steps { sh 'npm run export:android' } }
    }
    post { success { archiveArtifacts artifacts: 'dist/**', fingerprint: true } }
}
